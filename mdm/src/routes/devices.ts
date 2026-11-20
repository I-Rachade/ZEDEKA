/** Appareils, commandes à distance, localisation. */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { canAccessDevice, requireAdmin, requireUser } from "../lib/auth";
import { decryptJson } from "../lib/crypto";
import { createCommand, lastLocations } from "../lib/services";
import { audit, clientIp, HttpError } from "../lib/util";
import { COMMANDS } from "../providers";

export const deviceRoutes = new Hono<AppEnv>();
deviceRoutes.use("*", requireUser);

const PUBLIC_COLS = `d.id, d.name, d.platform, d.management, d.model, d.os_version, d.serial, d.wifi_mac, d.owner_user_id,
  u.name AS owner_name, u.email AS owner_email, d.ownership, d.status, d.lost_mode, d.battery, d.storage_used_pct,
  d.data_usage_mb, d.encrypted, d.passcode_set, d.rooted, d.supervised, d.compliant, d.compliance_issues,
  d.last_seen, d.enrolled_at`;

async function loadDevice(c: any, id: string) {
  const d = await c.env.DB.prepare(`SELECT ${PUBLIC_COLS}, d.provider_ref, d.imei_enc FROM devices d LEFT JOIN users u ON u.id = d.owner_user_id WHERE d.id = ?`)
    .bind(id).first();
  if (!d) throw new HttpError(404, "Appareil introuvable");
  if (!canAccessDevice(c.get("user"), d)) throw new HttpError(403, "Cet appareil ne vous est pas attribué");
  return d as Record<string, any>;
}

deviceRoutes.get("/devices", async (c) => {
  const u = c.get("user");
  const { q, platform, status, compliant } = c.req.query();
  const where: string[] = ["d.status != 'retiré'"];
  const args: unknown[] = [];
  if (u.role !== "admin") { where.push("d.owner_user_id = ?"); args.push(u.id); }
  if (platform) { where.push("d.platform = ?"); args.push(platform); }
  if (status) { where.push("d.status = ?"); args.push(status); }
  if (compliant !== undefined && compliant !== "") { where.push("d.compliant = ?"); args.push(compliant === "1" ? 1 : 0); }
  if (q) { where.push("(d.name LIKE ? OR d.model LIKE ? OR u.name LIKE ? OR d.serial LIKE ?)"); args.push(...Array(4).fill(`%${q}%`)); }
  const { results } = await c.env.DB.prepare(
    `SELECT ${PUBLIC_COLS} FROM devices d LEFT JOIN users u ON u.id = d.owner_user_id WHERE ${where.join(" AND ")} ORDER BY d.name`,
  ).bind(...args).all();
  return c.json(results.map((d: any) => ({ ...d, compliance_issues: JSON.parse(d.compliance_issues) })));
});

deviceRoutes.get("/devices/:id", async (c) => {
  const d = await loadDevice(c, c.req.param("id"));
  const [apps, commands] = await Promise.all([
    c.env.DB.prepare("SELECT identifier, name, version, updated_at FROM device_apps WHERE device_id = ? ORDER BY name").bind(d.id).all(),
    c.env.DB.prepare("SELECT id, type, status, created_by, reason, created_at, done_at FROM commands WHERE device_id = ? ORDER BY id DESC LIMIT 30").bind(d.id).all(),
  ]);
  const imei = c.get("user").role === "admin" && d.imei_enc ? await decryptJson<string>(d.imei_enc, c.env.DATA_KEY) : undefined;
  delete d.imei_enc; delete d.provider_ref;
  return c.json({
    ...d, imei, compliance_issues: JSON.parse(d.compliance_issues),
    apps: apps.results, commands: commands.results,
    location: (await lastLocations(c.env, d.id, 1))[0] ?? null,
    allowed_commands: Object.entries(COMMANDS)
      .filter(([, def]) => c.get("user").role === "admin" || def.user)
      .map(([type, def]) => ({ type, ...def })),
  });
});

deviceRoutes.patch("/devices/:id", requireAdmin, async (c) => {
  const d = await loadDevice(c, c.req.param("id"));
  const b = await c.req.json<{ name?: string; owner_user_id?: number | null; ownership?: string }>();
  if (b.name) await c.env.DB.prepare("UPDATE devices SET name = ? WHERE id = ?").bind(b.name, d.id).run();
  if (b.owner_user_id !== undefined) await c.env.DB.prepare("UPDATE devices SET owner_user_id = ? WHERE id = ?").bind(b.owner_user_id, d.id).run();
  if (b.ownership) await c.env.DB.prepare("UPDATE devices SET ownership = ? WHERE id = ?").bind(b.ownership, d.id).run();
  await audit(c.env, c.get("user").email, "modification_appareil", d.id, JSON.stringify(b), clientIp(c));
  return c.json({ ok: true });
});

/** Retire un appareil du parc (fin de gestion). */
deviceRoutes.delete("/devices/:id", requireAdmin, async (c) => {
  const d = await loadDevice(c, c.req.param("id"));
  await c.env.DB.prepare("UPDATE devices SET status = 'retiré', agent_token_hash = NULL WHERE id = ?").bind(d.id).run();
  await audit(c.env, c.get("user").email, "retrait_appareil", d.id, "", clientIp(c));
  return c.json({ ok: true });
});

/** Envoie une commande à distance. Les utilisateurs ne peuvent lancer que les commandes non sensibles sur leurs appareils. */
deviceRoutes.post("/devices/:id/commands", async (c) => {
  const d = await loadDevice(c, c.req.param("id"));
  const { type, params, reason } = await c.req.json<{ type: string; params?: Record<string, unknown>; reason?: string }>();
  const def = COMMANDS[type];
  if (!def) throw new HttpError(400, "Commande inconnue");
  if (c.get("user").role !== "admin" && !def.user) throw new HttpError(403, "Commande réservée aux administrateurs");
  if (type === "locate" && c.get("user").role === "admin" && !reason && !d.lost_mode)
    throw new HttpError(422, "Indiquez le motif de la localisation (exigence RGPD)");
  const res = await createCommand(c.env, c.get("user").email, d, type, params ?? {}, reason ?? "", clientIp(c));
  return c.json(res, 202);
});

deviceRoutes.get("/devices/:id/locations", async (c) => {
  const d = await loadDevice(c, c.req.param("id"));
  return c.json(await lastLocations(c.env, d.id, Number(c.req.query("limit") ?? 50)));
});

/** Carte : dernière position connue de chaque appareil (dans la limite de la durée de conservation). */
deviceRoutes.get("/map", async (c) => {
  const u = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT ${PUBLIC_COLS} FROM devices d LEFT JOIN users u ON u.id = d.owner_user_id
     WHERE d.status IN ('actif','perdu') ${u.role === "admin" ? "" : "AND d.owner_user_id = ?"}`,
  ).bind(...(u.role === "admin" ? [] : [u.id])).all<any>();
  const out = [];
  for (const d of results) {
    const loc = (await lastLocations(c.env, d.id, 1))[0];
    if (loc) out.push({ id: d.id, name: d.name, platform: d.platform, owner_name: d.owner_name, lost_mode: d.lost_mode, compliant: d.compliant, ...loc });
  }
  return c.json(out);
});
