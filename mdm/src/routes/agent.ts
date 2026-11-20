/**
 * Points d'entrée côté appareils et réseau :
 *  - /agent/*            : agent compagnon (enrôlement, check-in, résultats de commandes)
 *  - /api/network/events : contrôleur Wi-Fi / RADIUS / NAC → enrôlement automatique et quarantaine
 *  - /mdm/apple/*        : protocole MDM natif Apple
 *  - /enroll             : page d'enrôlement affichée par le portail captif
 */
import { Hono } from "hono";
import type { AppEnv, Env } from "../env";
import { deviceFromToken } from "../lib/auth";
import { encryptJson, randomToken, sha256 } from "../lib/crypto";
import { completeCommand, evaluateCompliance, getPolicyBundle, locationAllowed, storeLocation } from "../lib/services";
import { audit, escapeHtml, getPolicy, HttpError, nowIso, openAlert } from "../lib/util";
import { appleCommand, buildPlist, parsePlist } from "../providers/apple-mdm";

export const agentRoutes = new Hono<AppEnv>();

async function consumeEnrollmentToken(env: Env, token: string, platform: string) {
  const t = await env.DB.prepare("SELECT * FROM enrollment_tokens WHERE token_hash = ?").bind(await sha256(token ?? "")).first<any>();
  if (!t) throw new HttpError(401, "Jeton d'enrôlement invalide");
  if (t.expires_at < new Date().toISOString()) throw new HttpError(401, "Jeton d'enrôlement expiré");
  if (t.uses >= t.max_uses) throw new HttpError(401, "Jeton d'enrôlement déjà utilisé");
  if (t.platform !== "any" && t.platform !== platform) throw new HttpError(422, `Jeton réservé aux appareils ${t.platform}`);
  await env.DB.prepare("UPDATE enrollment_tokens SET uses = uses + 1 WHERE id = ?").bind(t.id).run();
  return t;
}

// ------------------------------------------------------------------ agent compagnon
agentRoutes.post("/agent/enroll", async (c) => {
  const { enrollment_token, device } = await c.req.json<{ enrollment_token: string; device: Record<string, any> }>();
  if (!device || !["android", "ios"].includes(device.platform)) throw new HttpError(422, "Plateforme android ou ios requise");
  const t = await consumeEnrollmentToken(c.env, enrollment_token, device.platform);
  const id = crypto.randomUUID();
  const deviceToken = randomToken(32);
  await c.env.DB.prepare(
    `INSERT INTO devices (id, name, platform, management, provider_ref, model, os_version, serial, imei_enc, wifi_mac,
       owner_user_id, ownership, agent_token_hash, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, device.name ?? `${device.platform}-${id.slice(0, 6)}`, device.platform, device.management ?? "agent",
    device.provider_ref ?? null, device.model ?? null, device.os_version ?? null, device.serial ?? null,
    device.imei ? await encryptJson(device.imei, c.env.DATA_KEY) : null, device.wifi_mac?.toLowerCase() ?? null,
    t.owner_user_id, t.ownership, await sha256(deviceToken), nowIso()).run();
  await audit(c.env, `appareil:${id}`, "enrolement", device.name ?? id, `jeton ${t.source}`);
  return c.json({ device_id: id, device_token: deviceToken, checkin_interval_seconds: Number(c.env.CHECKIN_INTERVAL_SECONDS) }, 201);
});

agentRoutes.post("/agent/checkin", async (c) => {
  const device = await deviceFromToken(c.env, c.req.header("authorization"));
  const body = await c.req.json<{ inventory?: Record<string, any>; apps?: { identifier: string; name?: string; version?: string }[];
    location?: { lat: number; lon: number; accuracy?: number; source?: string } }>();
  const inv = body.inventory ?? {};
  const bool = (v: unknown) => (v === undefined || v === null ? null : v ? 1 : 0);
  await c.env.DB.prepare(
    `UPDATE devices SET os_version = COALESCE(?, os_version), model = COALESCE(?, model), battery = COALESCE(?, battery),
       storage_used_pct = COALESCE(?, storage_used_pct), data_usage_mb = COALESCE(?, data_usage_mb),
       encrypted = COALESCE(?, encrypted), passcode_set = COALESCE(?, passcode_set), rooted = COALESCE(?, rooted),
       supervised = COALESCE(?, supervised), wifi_mac = COALESCE(?, wifi_mac), last_seen = ? WHERE id = ?`,
  ).bind(inv.os_version ?? null, inv.model ?? null, inv.battery ?? null, inv.storage_used_pct ?? null, inv.data_usage_mb ?? null,
    bool(inv.encrypted), bool(inv.passcode_set), bool(inv.rooted), bool(inv.supervised), inv.wifi_mac?.toLowerCase() ?? null,
    nowIso(), device.id).run();

  if (body.apps) {
    const now = nowIso();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM device_apps WHERE device_id = ?").bind(device.id),
      ...body.apps.slice(0, 500).map((a) => c.env.DB.prepare(
        "INSERT INTO device_apps (device_id, identifier, name, version, updated_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(device.id, a.identifier, a.name ?? a.identifier, a.version ?? null, now)),
    ]);
  }

  // RGPD : la position n'est enregistrée que si la collecte est justifiée à cet instant
  const fresh = { ...device, ...(await c.env.DB.prepare("SELECT * FROM devices WHERE id = ?").bind(device.id).first<any>()) };
  const allowLoc = await locationAllowed(c.env, fresh);
  if (body.location && allowLoc) await storeLocation(c.env, fresh, body.location);

  const issues = await evaluateCompliance(c.env, fresh);

  const { results: cmds } = await c.env.DB.prepare(
    "SELECT id, type, params FROM commands WHERE device_id = ? AND status = 'en_file' ORDER BY id LIMIT 20",
  ).bind(device.id).all<any>();
  if (cmds.length)
    await c.env.DB.prepare(`UPDATE commands SET status = 'envoyée', sent_at = ? WHERE id IN (${cmds.map(() => "?").join(",")})`)
      .bind(nowIso(), ...cmds.map((x) => x.id)).run();

  return c.json({
    commands: cmds.map((x) => ({ id: x.id, type: x.type, params: JSON.parse(x.params) })),
    policies: await getPolicyBundle(c.env, fresh.platform),
    compliance: { compliant: issues.length === 0, issues },
    lost_mode: !!fresh.lost_mode,
    report_location: fresh.lost_mode || c.env.LOCATION_MODE === "continuous",
    next_checkin_seconds: Number(fresh.lost_mode ? c.env.LOST_MODE_INTERVAL_SECONDS : c.env.CHECKIN_INTERVAL_SECONDS),
  });
});

agentRoutes.post("/agent/commands/:id/result", async (c) => {
  const device = await deviceFromToken(c.env, c.req.header("authorization"));
  const { status, result, location } = await c.req.json<{ status: "terminée" | "échec"; result?: unknown;
    location?: { lat: number; lon: number; accuracy?: number; source?: string } }>();
  if (location) {
    const cmd = await c.env.DB.prepare("SELECT type FROM commands WHERE id = ? AND device_id = ?").bind(c.req.param("id"), device.id).first<any>();
    if (cmd?.type === "locate" || device.lost_mode) await storeLocation(c.env, device, location);
  }
  await completeCommand(c.env, Number(c.req.param("id")), device.id, status === "échec" ? "échec" : "terminée", result);
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ enrôlement automatique à la connexion réseau
/**
 * Appelé par le contrôleur Wi-Fi, le serveur RADIUS ou la NAC à chaque connexion d'un appareil.
 * Réponse : autoriser (appareil géré et conforme), quarantaine (non conforme / perdu) ou enrôlement
 * (appareil inconnu → VLAN d'enrôlement + portail captif avec un jeton à usage unique).
 */
agentRoutes.post("/api/network/events", async (c) => {
  if (!c.env.NETWORK_TOKEN || c.req.header("x-network-token") !== c.env.NETWORK_TOKEN) throw new HttpError(401, "Jeton réseau invalide");
  const ev = await c.req.json<{ mac: string; ip?: string; ssid?: string; username?: string }>();
  const mac = (ev.mac ?? "").toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) throw new HttpError(422, "Adresse MAC invalide");
  const device = await c.env.DB.prepare("SELECT * FROM devices WHERE wifi_mac = ? AND status IN ('actif','perdu')").bind(mac).first<any>();
  const rules = await getPolicy<any>(c.env, "compliance");
  let decision: string, payload: Record<string, unknown> = {};

  if (device?.lost_mode) {
    decision = "quarantaine";
    await openAlert(c.env, device.id, "perdu_detecte_reseau", "critique",
      `${device.name} (déclaré perdu) vient de se connecter au réseau ${ev.ssid ?? ""} depuis ${ev.ip ?? "?"}`);
  } else if (device && !device.compliant && rules.quarantine_noncompliant) {
    decision = "quarantaine";
    payload = { issues: JSON.parse(device.compliance_issues) };
  } else if (device) {
    decision = "autoriser";
    await c.env.DB.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").bind(nowIso(), device.id).run();
  } else {
    decision = "enrôlement";
    const owner = ev.username
      ? await c.env.DB.prepare("SELECT id FROM users WHERE email = ? OR email LIKE ?").bind(ev.username.toLowerCase(), `${ev.username.toLowerCase()}@%`).first<{ id: number }>()
      : null;
    const token = randomToken(24);
    await c.env.DB.prepare(
      `INSERT INTO enrollment_tokens (token_hash, label, owner_user_id, platform, ownership, max_uses, expires_at, source, created_by)
       VALUES (?, ?, ?, 'any', 'entreprise', 1, ?, 'réseau', 'réseau')`,
    ).bind(await sha256(token), `réseau:${mac}`, owner?.id ?? null, new Date(Date.now() + 86400_000).toISOString()).run();
    payload = { vlan: "onboarding", portal_url: `${new URL(c.req.url).origin}/enroll?t=${token}` };
  }
  await c.env.DB.prepare("INSERT INTO network_events (mac, ip, ssid, username, decision, device_id) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(mac, ev.ip ?? null, ev.ssid ?? null, ev.username ?? null, decision, device?.id ?? null).run();
  return c.json({ decision, device_id: device?.id ?? null, ...payload });
});

/** Page affichée par le portail captif / le lien d'invitation. */
agentRoutes.get("/enroll", async (c) => {
  const t = c.req.query("t") ?? "";
  // Jeton limité à [A-Za-z0-9_-] et tout ce qui vient de la requête échappé : pas de HTML ni de script injectable.
  const safe = escapeHtml(t.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128));
  const origin = escapeHtml(new URL(c.req.url).origin);
  const org = escapeHtml(c.env.ORG_NAME);
  return c.html(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Enrôlement de votre appareil</title><link rel="stylesheet" href="/style.css"></head>
<body class="enroll"><main class="card enroll-card">
<h1>Enrôler votre appareil</h1>
<p>Pour accéder au réseau de ${org}, votre téléphone doit être enregistré dans la plateforme de gestion.
Les données collectées et leur usage sont décrits dans la <a href="/#/confidentialite">notice de confidentialité</a>.</p>
<h2>Android</h2><ol><li>Installez l'application <b>Agent MDM</b> fournie par votre service informatique.</li>
<li>Ouvrez-la et scannez ce QR code, ou saisissez le code ci-dessous.</li></ol>
<h2>iPhone / iPad</h2><ol><li>Ouvrez l'application <b>Agent MDM</b> (App Store / distribution interne) et saisissez le code,
ou installez le profil d'entreprise fourni par le service informatique.</li></ol>
<div id="qr" class="qr" data-server="${origin}" data-token="${safe}"></div>
<p class="code">Code d'enrôlement : <code>${safe}</code></p>
<p class="muted">Serveur : <code>${origin}</code> · Ce code est à usage unique et expire sous 24 h.</p>
</main>
<script src="/vendor/qrcode.min.js"></script>
<script src="/enroll.js"></script>
</body></html>`);
});

// ------------------------------------------------------------------ protocole MDM Apple
const plistResponse = (body: string) => new Response(body, { headers: { "content-type": "application/xml" } });

agentRoutes.put("/mdm/apple/checkin", async (c) => {
  const msg = parsePlist(await c.req.text());
  const t = c.req.query("t") ?? "";
  const udid = String(msg.UDID ?? "");
  const existing = await c.env.DB.prepare("SELECT * FROM devices WHERE management = 'apple_mdm' AND serial = ? OR id = ?")
    .bind(msg.SerialNumber ?? "", udid).first<any>();
  if (msg.MessageType === "Authenticate") {
    if (!existing) {
      const tok = await consumeEnrollmentToken(c.env, t, "ios");
      await c.env.DB.prepare(
        `INSERT INTO devices (id, name, platform, management, provider_ref, model, os_version, serial, imei_enc, owner_user_id, ownership, last_seen)
         VALUES (?, ?, 'ios', 'apple_mdm', '{}', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(udid, msg.DeviceName ?? `iOS-${udid.slice(0, 6)}`, msg.ProductName ?? msg.Model ?? null, msg.OSVersion ?? null,
        msg.SerialNumber ?? null, msg.IMEI ? await encryptJson(msg.IMEI, c.env.DATA_KEY) : null, tok.owner_user_id, tok.ownership, nowIso()).run();
      await audit(c.env, `appareil:${udid}`, "enrolement", msg.DeviceName ?? udid, "apple_mdm");
    }
  } else if (msg.MessageType === "TokenUpdate") {
    if (!existing) throw new HttpError(401, "Appareil inconnu");
    const token = [...atob(String(msg.Token ?? ""))].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    await c.env.DB.prepare("UPDATE devices SET provider_ref = ?, last_seen = ? WHERE id = ?")
      .bind(JSON.stringify({ token, push_magic: msg.PushMagic, topic: msg.Topic }), nowIso(), existing.id).run();
  } else if (msg.MessageType === "CheckOut" && existing) {
    await c.env.DB.prepare("UPDATE devices SET status = 'retiré' WHERE id = ?").bind(existing.id).run();
  }
  return plistResponse(buildPlist({}));
});

agentRoutes.put("/mdm/apple/server", async (c) => {
  const msg = parsePlist(await c.req.text());
  const device = await c.env.DB.prepare("SELECT * FROM devices WHERE id = ? AND management = 'apple_mdm'").bind(String(msg.UDID ?? "")).first<any>();
  if (!device || device.status === "retiré") throw new HttpError(401, "Appareil inconnu");
  await c.env.DB.prepare("UPDATE devices SET last_seen = ? WHERE id = ?").bind(nowIso(), device.id).run();

  if (msg.CommandUUID && msg.Status && msg.Status !== "Idle") {
    if (msg.Latitude !== undefined && msg.Longitude !== undefined)
      await storeLocation(c.env, device, { lat: Number(msg.Latitude), lon: Number(msg.Longitude), source: "gps" });
    await completeCommand(c.env, Number(msg.CommandUUID), device.id, msg.Status === "Acknowledged" ? "terminée" : "échec", msg);
  }
  const next = await c.env.DB.prepare("SELECT id, type, params FROM commands WHERE device_id = ? AND status = 'en_file' ORDER BY id LIMIT 1")
    .bind(device.id).first<any>();
  if (!next) return new Response(null, { status: 200 });
  const command = appleCommand({ id: next.id, device_id: device.id, type: next.type, params: JSON.parse(next.params) });
  if (!command) {
    await completeCommand(c.env, next.id, device.id, "échec", { error: "Commande non prise en charge par iOS" });
    return new Response(null, { status: 200 });
  }
  await c.env.DB.prepare("UPDATE commands SET status = 'envoyée', sent_at = ? WHERE id = ?").bind(nowIso(), next.id).run();
  return plistResponse(buildPlist({ CommandUUID: String(next.id), Command: command }));
});
