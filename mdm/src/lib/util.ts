import type { Context } from "hono";
import type { AppEnv, Env } from "../env";
import { randomToken, signJwt } from "./crypto";

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
export const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString().replace(/\.\d{3}Z$/, "Z");

export class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 422 | 429, message: string) {
    super(message);
  }
}

/** Journal d'audit : toute action sensible est tracée (qui, quoi, sur quoi, pourquoi, depuis où). */
export async function audit(env: Env, actor: string, action: string, target = "", reason = "", ip = "") {
  await env.DB.prepare("INSERT INTO audit_log (actor, action, target, reason, ip) VALUES (?, ?, ?, ?, ?)")
    .bind(actor, action, target, reason, ip).run();
}

export const clientIp = (c: Context<AppEnv>) => c.req.header("cf-connecting-ip") ?? "";

/** Distance en km entre deux points GPS (formule de haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export const majorVersion = (v?: string | null) => (v ? parseFloat(v) : NaN);

export async function openAlert(env: Env, deviceId: string | null, type: string, severity: string, message: string) {
  const open = await env.DB.prepare("SELECT id FROM alerts WHERE device_id IS ? AND type = ? AND status = 'ouverte'")
    .bind(deviceId, type).first();
  if (open) return false;
  const row = await env.DB.prepare("INSERT INTO alerts (device_id, type, severity, message) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(deviceId, type, severity, message).first<{ id: number }>();
  if (severity === "critique" || severity === "haute") await pushToZedeka(env, row?.id ?? 0, severity, message);
  return true;
}

/**
 * Alerte grave (perte, vol, protection désactivée, hors zone…) envoyée au back-office Zedeka, qui la pousse en
 * notification au directeur et à l'adjoint (catégorie « Technique »). Jeton HS256 d'une minute signé avec SSO_SECRET
 * (= MDM_SSO_SECRET de zedeka-api). Sans liaison ZEDEKA_API ni secret (poste de développement), rien n'est envoyé.
 * Un échec n'empêche jamais l'ouverture de l'alerte dans la console.
 */
export async function pushToZedeka(env: Env, alertId: number, severity: string, message: string) {
  if (!env.ZEDEKA_API || !env.SSO_SECRET || env.SSO_SECRET.length < 32) return false;
  try {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt({ iss: "zedeka-mdm", aud: "zedeka", iat: now, exp: now + 60, jti: randomToken(12),
      alert_id: alertId, severity, message: message.slice(0, 300) }, env.SSO_SECRET);
    const res = await env.ZEDEKA_API.fetch("https://zedeka-api/api/mdm/alerts", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (e) {
    console.error("alerte vers Zedeka", e);
    return false;
  }
}

export async function closeAlert(env: Env, deviceId: string, type: string) {
  await env.DB.prepare("UPDATE alerts SET status = 'résolue', closed_at = ? WHERE device_id = ? AND type = ? AND status = 'ouverte'")
    .bind(nowIso(), deviceId, type).run();
}

export async function getPolicy<T = Record<string, unknown>>(env: Env, type: string, platform?: string): Promise<T> {
  const row = await env.DB.prepare(
    "SELECT settings FROM policies WHERE type = ? AND scope IN ('all', ?) ORDER BY scope = 'all' LIMIT 1",
  ).bind(type, platform ?? "all").first<{ settings: string }>();
  return (row ? JSON.parse(row.settings) : {}) as T;
}

/** Échappe une valeur avant de l'insérer dans du HTML généré côté serveur. */
export const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
