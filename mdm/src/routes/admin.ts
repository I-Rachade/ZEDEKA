/** Applications, politiques, alertes, statistiques, audit et enrôlement (administrateurs). */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { requireAdmin, requireUser } from "../lib/auth";
import { randomToken, sha256 } from "../lib/crypto";
import { createCommand, evaluateCompliance, runRetention } from "../lib/services";
import { agoIso, audit, clientIp, HttpError, nowIso } from "../lib/util";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireUser);

// ------------------------------------------------------------------ alertes (lecture : tous, filtrées par propriétaire)
adminRoutes.get("/alerts", async (c) => {
  const u = c.get("user");
  const status = c.req.query("status") ?? "ouverte";
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, d.name AS device_name, d.platform FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
     WHERE a.status = ? ${u.role === "admin" ? "" : "AND d.owner_user_id = ?"}
     ORDER BY CASE a.severity WHEN 'critique' THEN 0 WHEN 'haute' THEN 1 WHEN 'moyenne' THEN 2 ELSE 3 END, a.created_at DESC LIMIT 200`,
  ).bind(...(u.role === "admin" ? [status] : [status, u.id])).all();
  return c.json(results);
});

adminRoutes.use("*", requireAdmin);

adminRoutes.post("/alerts/:id/close", async (c) => {
  const { comment } = await c.req.json<{ comment?: string }>().catch(() => ({ comment: "" }));
  await c.env.DB.prepare("UPDATE alerts SET status = 'résolue', closed_at = ? WHERE id = ?").bind(nowIso(), c.req.param("id")).run();
  await audit(c.env, c.get("user").email, "cloture_alerte", c.req.param("id"), comment ?? "", clientIp(c));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ statistiques du tableau de bord
adminRoutes.get("/stats", async (c) => {
  const db = c.env.DB;
  const one = (sql: string, ...a: unknown[]) => db.prepare(sql).bind(...a).first<any>();
  const all = async (sql: string, ...a: unknown[]) => (await db.prepare(sql).bind(...a).all<any>()).results;
  const active = "status IN ('actif','perdu')";
  const [totals, byPlatform, byOs, byStatus, alertsBySeverity, enrollments, topApps, commands, recent] = await Promise.all([
    one(`SELECT COUNT(*) AS total, SUM(compliant) AS compliant, SUM(lost_mode) AS lost,
           SUM(CASE WHEN last_seen > ? THEN 1 ELSE 0 END) AS online,
           ROUND(AVG(battery)) AS avg_battery, ROUND(AVG(storage_used_pct)) AS avg_storage,
           SUM(data_usage_mb) AS data_usage_mb,
           SUM(CASE WHEN ownership = 'personnel' THEN 1 ELSE 0 END) AS byod
         FROM devices WHERE ${active}`, agoIso(3600_000)),
    all(`SELECT platform, COUNT(*) AS n FROM devices WHERE ${active} GROUP BY platform`),
    all(`SELECT platform || ' ' || COALESCE(CAST(os_version AS INTEGER), '?') AS os, COUNT(*) AS n FROM devices WHERE ${active} GROUP BY os ORDER BY n DESC`),
    all(`SELECT status, COUNT(*) AS n FROM devices GROUP BY status`),
    all(`SELECT severity, COUNT(*) AS n FROM alerts WHERE status = 'ouverte' GROUP BY severity`),
    all(`SELECT substr(enrolled_at, 1, 10) AS day, COUNT(*) AS n FROM devices WHERE enrolled_at > ? GROUP BY day ORDER BY day`, agoIso(30 * 86400_000)),
    all(`SELECT name, COUNT(*) AS n FROM device_apps GROUP BY identifier ORDER BY n DESC LIMIT 8`),
    all(`SELECT type, COUNT(*) AS n FROM commands WHERE created_at > ? GROUP BY type ORDER BY n DESC`, agoIso(30 * 86400_000)),
    all(`SELECT at, actor, action, target FROM audit_log WHERE action LIKE 'commande:%' OR action LIKE 'enrolement%' ORDER BY id DESC LIMIT 8`),
  ]);
  return c.json({ totals, byPlatform, byOs, byStatus, alertsBySeverity, enrollments, topApps, commands, recent });
});

adminRoutes.get("/audit", async (c) => {
  const { q } = c.req.query();
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM audit_log ${q ? "WHERE actor LIKE ? OR action LIKE ? OR target LIKE ?" : ""} ORDER BY id DESC LIMIT 300`,
  ).bind(...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [])).all();
  return c.json(results);
});

// ------------------------------------------------------------------ catalogue d'applications
adminRoutes.get("/apps", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT a.*, (SELECT COUNT(*) FROM device_apps d WHERE d.identifier = a.identifier) AS installs FROM apps a ORDER BY a.name`,
  ).all();
  return c.json(results);
});

adminRoutes.post("/apps", async (c) => {
  const b = await c.req.json<any>();
  if (!b.name || !b.identifier || !["android", "ios"].includes(b.platform)) throw new HttpError(422, "Nom, identifiant et plateforme requis");
  const row = await c.env.DB.prepare(
    `INSERT INTO apps (name, identifier, platform, version, category, source, download_url, mandatory, blocked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  ).bind(b.name, b.identifier, b.platform, b.version ?? null, b.category ?? null, b.source ?? "store",
    b.download_url ?? null, b.mandatory ? 1 : 0, b.blocked ? 1 : 0).first<{ id: number }>()
    .catch(() => { throw new HttpError(409, "Application déjà au catalogue"); });
  await audit(c.env, c.get("user").email, "ajout_application", b.identifier, "", clientIp(c));
  return c.json({ id: row!.id }, 201);
});

adminRoutes.patch("/apps/:id", async (c) => {
  const b = await c.req.json<any>();
  const fields = ["name", "version", "category", "download_url", "mandatory", "blocked"].filter((f) => b[f] !== undefined);
  if (!fields.length) return c.json({ ok: true });
  await c.env.DB.prepare(`UPDATE apps SET ${fields.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`)
    .bind(...fields.map((f) => (typeof b[f] === "boolean" ? (b[f] ? 1 : 0) : b[f])), c.req.param("id")).run();
  await audit(c.env, c.get("user").email, "modification_application", c.req.param("id"), JSON.stringify(b), clientIp(c));
  return c.json({ ok: true });
});

adminRoutes.delete("/apps/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM apps WHERE id = ?").bind(c.req.param("id")).run();
  await audit(c.env, c.get("user").email, "suppression_application", c.req.param("id"), "", clientIp(c));
  return c.json({ ok: true });
});

/** Installe (ou désinstalle) une application du catalogue sur une sélection d'appareils ou tout le parc compatible. */
adminRoutes.post("/apps/:id/deploy", async (c) => {
  const app = await c.env.DB.prepare("SELECT * FROM apps WHERE id = ?").bind(c.req.param("id")).first<any>();
  if (!app) throw new HttpError(404, "Application introuvable");
  const { device_ids, action = "install" } = await c.req.json<{ device_ids?: string[]; action?: "install" | "remove" }>();
  const { results: devices } = await c.env.DB.prepare(
    "SELECT * FROM devices WHERE platform = ? AND status IN ('actif','perdu')",
  ).bind(app.platform).all<any>();
  const targets = device_ids?.length ? devices.filter((d) => device_ids.includes(d.id)) : devices;
  const type = action === "remove" ? "remove_app" : "install_app";
  for (const d of targets)
    await createCommand(c.env, c.get("user").email, d, type,
      { identifier: app.identifier, name: app.name, version: app.version, download_url: app.download_url, source: app.source }, "", clientIp(c));
  return c.json({ commands: targets.length }, 202);
});

// ------------------------------------------------------------------ politiques
const POLICY_TYPES = ["passcode", "restrictions", "compliance"];

adminRoutes.get("/policies", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM policies ORDER BY type, scope").all<any>();
  return c.json(results.map((p) => ({ ...p, settings: JSON.parse(p.settings) })));
});

adminRoutes.put("/policies/:type", async (c) => {
  const type = c.req.param("type");
  if (!POLICY_TYPES.includes(type)) throw new HttpError(404, "Type de politique inconnu");
  const { scope = "all", settings } = await c.req.json<{ scope?: string; settings: Record<string, unknown> }>();
  if (type === "passcode") {
    const s = settings as any;
    if (s.min_length < 4 || s.min_length > 16) throw new HttpError(422, "Longueur minimale entre 4 et 16");
    if (s.max_failed_attempts < 3 || s.max_failed_attempts > 20) throw new HttpError(422, "Tentatives autorisées entre 3 et 20");
  }
  await c.env.DB.prepare(
    `INSERT INTO policies (type, scope, settings, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (type, scope) DO UPDATE SET settings = excluded.settings, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(type, scope, JSON.stringify(settings), c.get("user").email, nowIso()).run();
  await audit(c.env, c.get("user").email, `politique:${type}`, scope, JSON.stringify(settings), clientIp(c));

  // Propagation : les appareils reçoivent la nouvelle politique à leur prochain contact
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM devices WHERE status IN ('actif','perdu') ${scope === "all" ? "" : "AND platform = ?"}`,
  ).bind(...(scope === "all" ? [] : [scope])).all<any>();
  for (const d of results) {
    if (type === "compliance") await evaluateCompliance(c.env, d);
    else await createCommand(c.env, c.get("user").email, d, "sync_policy", { policy: type }, "", clientIp(c));
  }
  return c.json({ ok: true, devices: results.length });
});

// ------------------------------------------------------------------ enrôlement
adminRoutes.post("/enrollment/tokens", async (c) => {
  const b = await c.req.json<{ owner_email?: string; platform?: string; ownership?: string; max_uses?: number; days?: number; label?: string }>();
  let ownerId: number | null = null;
  if (b.owner_email) {
    const u = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(b.owner_email.toLowerCase()).first<{ id: number }>();
    if (!u) throw new HttpError(404, "Utilisateur inconnu");
    ownerId = u.id;
  }
  const token = randomToken(24);
  const expires = new Date(Date.now() + (b.days ?? 7) * 86400_000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO enrollment_tokens (token_hash, label, owner_user_id, platform, ownership, max_uses, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(await sha256(token), b.label ?? null, ownerId, b.platform ?? "any", b.ownership ?? "entreprise",
    b.max_uses ?? 1, expires, c.get("user").email).run();
  await audit(c.env, c.get("user").email, "enrolement:jeton", b.owner_email ?? b.label ?? "", "", clientIp(c));
  const origin = new URL(c.req.url).origin;
  return c.json({ token, expires_at: expires, enroll_url: `${origin}/enroll?t=${token}` }, 201);
});

adminRoutes.get("/enrollment/tokens", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.label, u.email AS owner_email, t.platform, t.ownership, t.max_uses, t.uses, t.expires_at, t.source, t.created_at
     FROM enrollment_tokens t LEFT JOIN users u ON u.id = t.owner_user_id ORDER BY t.id DESC LIMIT 100`,
  ).all();
  return c.json(results);
});

adminRoutes.get("/network/events", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT e.*, d.name AS device_name FROM network_events e LEFT JOIN devices d ON d.id = e.device_id ORDER BY e.id DESC LIMIT 200",
  ).all();
  return c.json(results);
});

adminRoutes.post("/retention/run", async (c) => {
  const res = await runRetention(c.env);
  await audit(c.env, c.get("user").email, "purge_rgpd", "", JSON.stringify(res), clientIp(c));
  return c.json(res);
});
