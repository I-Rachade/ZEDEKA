import type { MiddlewareHandler } from "hono";
import type { AppEnv, SessionUser } from "../env";
import { sha256, signJwt, verifyJwt } from "./crypto";
import { HttpError } from "./util";

/** Émet un jeton de session (JWT signé HS256) pour un utilisateur du portail. */
export async function issueToken(env: AppEnv["Bindings"], user: SessionUser) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: user.id, email: user.email, name: user.name, role: user.role, iat: now,
    exp: now + Number(env.TOKEN_MINUTES || 60) * 60 }, env.JWT_SECRET);
}

/** Exige une session valide (portail web). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = token ? await verifyJwt<{ sub: number }>(token, c.env.JWT_SECRET) : null;
  if (!payload) throw new HttpError(401, "Authentification requise");
  const user = await c.env.DB.prepare("SELECT id, email, name, role, active FROM users WHERE id = ?")
    .bind(payload.sub).first<SessionUser & { active: number }>();
  if (!user || !user.active) throw new HttpError(401, "Compte désactivé");
  c.set("user", { id: user.id, email: user.email, name: user.name, role: user.role });
  await next();
};

/** Réserve une route aux administrateurs. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user")?.role !== "admin") throw new HttpError(403, "Réservé aux administrateurs");
  await next();
};

/** Authentifie un appareil (agent) via son jeton propre, stocké haché en base. */
export async function deviceFromToken(env: AppEnv["Bindings"], header?: string) {
  const token = header?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Jeton d'appareil manquant");
  const device = await env.DB.prepare("SELECT * FROM devices WHERE agent_token_hash = ?")
    .bind(await sha256(token)).first<Record<string, any>>();
  if (!device || device.status === "retiré") throw new HttpError(401, "Appareil inconnu ou retiré");
  return device;
}

/** L'utilisateur peut-il agir sur cet appareil ? (admin : tous ; utilisateur : les siens) */
export function canAccessDevice(user: SessionUser, device: { owner_user_id: number | null }) {
  return user.role === "admin" || device.owner_user_id === user.id;
}
