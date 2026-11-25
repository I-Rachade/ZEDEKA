/** Logique métier partagée : conformité, commandes, localisation, alertes. */
import type { Env } from "../env";
import { COMMANDS, providerFor } from "../providers";
import { decryptJson, encryptJson } from "./crypto";
import { agoIso, audit, closeAlert, distanceKm, getPolicy, HttpError, majorVersion, nowIso, openAlert } from "./util";

export type Issue = { code: string; label: string; severity: "critique" | "haute" | "moyenne" };

// ------------------------------------------------------------------ conformité
/** Évalue la conformité d'un appareil (inspiré des « compliance policies » d'Intune). */
export async function evaluateCompliance(env: Env, device: Record<string, any>): Promise<Issue[]> {
  const rules = await getPolicy<any>(env, "compliance", device.platform);
  const issues: Issue[] = [];
  if (rules.block_rooted && device.rooted)
    issues.push({ code: "rooted", label: device.platform === "ios" ? "Appareil jailbreaké" : "Appareil rooté", severity: "critique" });
  if (rules.require_encryption && device.encrypted === 0)
    issues.push({ code: "encryption", label: "Stockage non chiffré", severity: "haute" });
  if (rules.require_passcode && device.passcode_set === 0)
    issues.push({ code: "passcode", label: "Aucun code de verrouillage", severity: "haute" });
  const min = device.platform === "ios" ? rules.min_os_ios : rules.min_os_android;
  if (min && majorVersion(device.os_version) < majorVersion(min))
    issues.push({ code: "os", label: `Système trop ancien (${device.os_version} < ${min})`, severity: "moyenne" });

  const { results: blocked } = await env.DB.prepare(
    `SELECT a.name FROM device_apps d JOIN apps a ON a.identifier = d.identifier AND a.platform = ?
     WHERE d.device_id = ? AND a.blocked = 1`).bind(device.platform, device.id).all<{ name: string }>();
  for (const b of blocked) issues.push({ code: `blocked:${b.name}`, label: `Application interdite : ${b.name}`, severity: "haute" });

  const { results: missing } = await env.DB.prepare(
    `SELECT a.name FROM apps a WHERE a.platform = ? AND a.mandatory = 1
     AND a.identifier NOT IN (SELECT identifier FROM device_apps WHERE device_id = ?)`).bind(device.platform, device.id).all<{ name: string }>();
  for (const m of missing) issues.push({ code: `missing:${m.name}`, label: `Application obligatoire absente : ${m.name}`, severity: "moyenne" });

  // Mise à jour de l'appareil et des alertes correspondantes
  const previous: Issue[] = JSON.parse(device.compliance_issues || "[]");
  await env.DB.prepare("UPDATE devices SET compliant = ?, compliance_issues = ? WHERE id = ?")
    .bind(issues.length ? 0 : 1, JSON.stringify(issues), device.id).run();
  for (const i of issues)
    await openAlert(env, device.id, `conformite:${i.code}`, i.severity, `${device.name} : ${i.label}`);
  for (const p of previous)
    if (!issues.find((i) => i.code === p.code)) await closeAlert(env, device.id, `conformite:${p.code}`);
  return issues;
}

// ------------------------------------------------------------------ commandes
export async function createCommand(env: Env, actor: string, device: Record<string, any>, type: string,
  params: Record<string, unknown> = {}, reason = "", ip = "") {
  const def = COMMANDS[type];
  if (!def) throw new HttpError(400, `Commande inconnue : ${type}`);
  if (def.destructive && !reason) throw new HttpError(422, "Un motif est obligatoire pour un effacement");
  if (device.status === "effacé" || device.status === "retiré") throw new HttpError(409, "Appareil effacé ou retiré");

  const row = await env.DB.prepare(
    "INSERT INTO commands (device_id, type, params, created_by, reason) VALUES (?, ?, ?, ?, ?) RETURNING id",
  ).bind(device.id, type, JSON.stringify(params), actor, reason).first<{ id: number }>();
  await audit(env, actor, `commande:${type}`, `${device.name} (${device.id})`, reason, ip);

  // Effets immédiats côté portail
  if (type === "lost_mode_on") {
    await env.DB.prepare("UPDATE devices SET lost_mode = 1, status = 'perdu' WHERE id = ?").bind(device.id).run();
    await openAlert(env, device.id, "perte_vol", "critique", `${device.name} déclaré perdu ou volé${reason ? ` : ${reason}` : ""}`);
  } else if (type === "lost_mode_off") {
    await env.DB.prepare("UPDATE devices SET lost_mode = 0, status = 'actif' WHERE id = ?").bind(device.id).run();
    await closeAlert(env, device.id, "perte_vol");
  }

  let done = false;
  try {
    done = await providerFor(device).dispatch(env, device, { id: row!.id, device_id: device.id, type, params });
  } catch (e) {
    await env.DB.prepare("UPDATE commands SET status = 'échec', result = ?, done_at = ? WHERE id = ?")
      .bind(String(e), nowIso(), row!.id).run();
    throw e;
  }
  if (done) await completeCommand(env, row!.id, device.id, "terminée", { via: device.management });
  return { id: row!.id, type, status: done ? "terminée" : "en_file" };
}

export async function completeCommand(env: Env, commandId: number, deviceId: string, status: string, result: unknown) {
  const cmd = await env.DB.prepare("SELECT type FROM commands WHERE id = ? AND device_id = ?")
    .bind(commandId, deviceId).first<{ type: string }>();
  if (!cmd) throw new HttpError(404, "Commande introuvable");
  await env.DB.prepare("UPDATE commands SET status = ?, result = ?, done_at = ? WHERE id = ?")
    .bind(status, JSON.stringify(result ?? {}), nowIso(), commandId).run();
  if (status === "terminée" && cmd.type === "wipe_full")
    await env.DB.prepare("UPDATE devices SET status = 'effacé', agent_token_hash = NULL WHERE id = ?").bind(deviceId).run();
  if (status === "terminée" && cmd.type === "wipe_corporate")
    await env.DB.prepare("UPDATE devices SET status = 'retiré', agent_token_hash = NULL WHERE id = ?").bind(deviceId).run();
}

// ------------------------------------------------------------------ localisation (RGPD)
/** La position peut-elle être collectée maintenant ? (mode perdu, demande motivée en cours ou mode continu) */
export async function locationAllowed(env: Env, device: Record<string, any>) {
  if (device.lost_mode || env.LOCATION_MODE === "continuous") return true;
  const pending = await env.DB.prepare(
    "SELECT id FROM commands WHERE device_id = ? AND type = 'locate' AND status IN ('en_file', 'envoyée') LIMIT 1",
  ).bind(device.id).first();
  return !!pending;
}

export async function storeLocation(env: Env, device: Record<string, any>,
  loc: { lat: number; lon: number; accuracy?: number; source?: string; at?: string }) {
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) throw new HttpError(400, "Coordonnées invalides");
  const at = loc.at ?? nowIso();
  await env.DB.prepare("INSERT INTO locations (device_id, payload, source, located_at) VALUES (?, ?, ?, ?)")
    .bind(device.id, await encryptJson({ lat: loc.lat, lon: loc.lon, accuracy: loc.accuracy ?? null }, env.DATA_KEY), loc.source ?? "gps", at).run();
  const [glat, glon, radius] = (env.GEOFENCE || "").split(",").map(Number);
  if (radius) {
    const d = distanceKm(glat, glon, loc.lat, loc.lon);
    if (d > radius) await openAlert(env, device.id, "hors_zone", "haute", `${device.name} est hors de la zone autorisée (${Math.round(d)} km)`);
    else await closeAlert(env, device.id, "hors_zone");
  }
}

export async function lastLocations(env: Env, deviceId: string, limit = 1) {
  const { results } = await env.DB.prepare(
    "SELECT payload, source, located_at FROM locations WHERE device_id = ? ORDER BY located_at DESC LIMIT ?",
  ).bind(deviceId, limit).all<{ payload: string; source: string; located_at: string }>();
  return Promise.all(results.map(async (r) => ({ ...(await decryptJson<any>(r.payload, env.DATA_KEY)), source: r.source, located_at: r.located_at })));
}

// ------------------------------------------------------------------ tâches planifiées
export async function runAlertRules(env: Env) {
  const limit = agoIso(Number(env.OFFLINE_ALERT_HOURS || 72) * 3600_000);
  const { results } = await env.DB.prepare(
    "SELECT id, name, last_seen FROM devices WHERE status IN ('actif', 'perdu')").all<any>();
  for (const d of results) {
    if (d.last_seen && d.last_seen < limit)
      await openAlert(env, d.id, "hors_ligne", "moyenne", `${d.name} n'a pas contacté le serveur depuis plus de ${env.OFFLINE_ALERT_HOURS} h`);
    else await closeAlert(env, d.id, "hors_ligne");
  }
}

export async function runRetention(env: Env) {
  const loc = agoIso(Number(env.LOCATION_RETENTION_DAYS || 30) * 86400_000);
  const aud = agoIso(Number(env.AUDIT_RETENTION_DAYS || 365) * 86400_000);
  const a = await env.DB.prepare("DELETE FROM locations WHERE located_at < ?").bind(loc).run();
  const b = await env.DB.prepare("DELETE FROM audit_log WHERE at < ?").bind(aud).run();
  const c = await env.DB.prepare("DELETE FROM alerts WHERE status = 'résolue' AND closed_at < ?").bind(aud).run();
  return { positions: a.meta.changes, audit: b.meta.changes, alertes: c.meta.changes };
}

/** Politiques transmises à l'agent à chaque check-in. */
export async function getPolicyBundle(env: Env, platform: string) {
  const { results: apps } = await env.DB.prepare(
    "SELECT name, identifier, version, source, download_url, mandatory, blocked FROM apps WHERE platform = ? AND (mandatory = 1 OR blocked = 1)",
  ).bind(platform).all<any>();
  return {
    passcode: await getPolicy(env, "passcode", platform),
    restrictions: await getPolicy(env, "restrictions", platform),
    mandatory_apps: apps.filter((a) => a.mandatory).map(({ mandatory, blocked, ...a }) => a),
    blocked_apps: apps.filter((a) => a.blocked).map((a) => a.identifier),
  };
}
