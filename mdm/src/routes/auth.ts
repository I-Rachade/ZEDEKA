/** Authentification, comptes et droits RGPD des personnes. */
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { issueToken, requireAdmin, requireUser } from "../lib/auth";
import { hashPassword, passwordProblems, randomToken, verifyJwt, verifyPassword } from "../lib/crypto";
import { lastLocations } from "../lib/services";
import { agoIso, audit, clientIp, HttpError } from "../lib/util";

export const authRoutes = new Hono<AppEnv>();

/** Première installation : crée le compte administrateur initial (une seule fois). */
authRoutes.post("/setup", async (c) => {
  const body = await c.req.json<{ setup_token: string; email: string; name: string; password: string }>();
  if (!c.env.SETUP_TOKEN || body.setup_token !== c.env.SETUP_TOKEN) throw new HttpError(403, "Jeton d'installation invalide");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  if (count!.n > 0) throw new HttpError(409, "La plateforme est déjà initialisée");
  const problems = passwordProblems(body.password);
  if (problems.length) throw new HttpError(422, "Mot de passe trop faible : " + problems.join(", "));
  await c.env.DB.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'admin', ?)")
    .bind(body.email.toLowerCase(), body.name, await hashPassword(body.password)).run();
  await audit(c.env, body.email, "installation", "", "", clientIp(c));
  return c.json({ ok: true });
});

authRoutes.post("/auth/login", async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const mail = (email ?? "").toLowerCase();
  // Anti force brute : 5 échecs en 15 minutes bloquent le compte temporairement
  const fails = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE actor = ? AND action = 'connexion_echouee' AND at > ?")
    .bind(mail, agoIso(15 * 60_000)).first<{ n: number }>();
  if (fails!.n >= 5) throw new HttpError(429, "Trop de tentatives, réessayez dans 15 minutes");
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ? AND active = 1").bind(mail).first<any>();
  if (!user || !(await verifyPassword(password ?? "", user.password_hash))) {
    await audit(c.env, mail, "connexion_echouee", "", "", clientIp(c));
    throw new HttpError(401, "Identifiants incorrects");
  }
  await audit(c.env, mail, "connexion", "", "", clientIp(c));
  const session = { id: user.id, email: user.email, name: user.name, role: user.role };
  return c.json({ token: await issueToken(c.env, session), user: session });
});

/**
 * Connexion depuis le back-office Zedeka : jeton HS256 d'une minute, à usage unique, signé avec SSO_SECRET
 * (même valeur que MDM_SSO_SECRET dans zedeka-api). Le compte est créé au premier passage, en administrateur.
 */
authRoutes.post("/auth/sso", async (c) => {
  if (!c.env.SSO_SECRET || c.env.SSO_SECRET.length < 32) throw new HttpError(403, "Connexion par le back-office non configurée");
  const { token } = await c.req.json<{ token: string }>();
  const claims = await verifyJwt<{ iss: string; aud: string; exp?: number; jti: string; email: string; name: string; role: string }>(token ?? "", c.env.SSO_SECRET);
  if (!claims || claims.iss !== "zedeka" || claims.aud !== "mdm" || !claims.exp || !claims.jti || !claims.email)
    throw new HttpError(401, "Lien expiré ou invalide : rouvrez le parc mobile depuis le back-office");
  const used = await c.env.DB.prepare("SELECT id FROM audit_log WHERE action = 'connexion_sso' AND reason = ?").bind(claims.jti).first();
  if (used) throw new HttpError(401, "Lien déjà utilisé : rouvrez le parc mobile depuis le back-office");
  const email = claims.email.toLowerCase();
  let user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<any>();
  if (!user) {
    // Pas de mot de passe local : ce compte ne s'ouvre que depuis le back-office.
    await c.env.DB.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, 'admin', ?)")
      .bind(email, claims.name || email, `sso$${randomToken(16)}`).run();
    user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<any>();
  } else if (!user.active) {
    throw new HttpError(403, "Compte désactivé dans le parc mobile");
  } else if (claims.role === "admin" && user.role !== "admin") {
    await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?").bind(user.id).run();
    user.role = "admin";
  }
  await audit(c.env, email, "connexion_sso", "back-office Zedeka", claims.jti, clientIp(c));
  const session = { id: user.id, email: user.email, name: user.name, role: user.role };
  return c.json({ token: await issueToken(c.env, session), user: session });
});

authRoutes.get("/auth/me", requireUser, (c) => c.json(c.get("user")));

authRoutes.post("/auth/password", requireUser, async (c) => {
  const { current, next } = await c.req.json<{ current: string; next: string }>();
  const u = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(u.id).first<any>();
  if (!(await verifyPassword(current, row.password_hash))) throw new HttpError(401, "Mot de passe actuel incorrect");
  const problems = passwordProblems(next);
  if (problems.length) throw new HttpError(422, "Mot de passe trop faible : " + problems.join(", "));
  await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(next), u.id).run();
  await audit(c.env, u.email, "changement_mot_de_passe", "", "", clientIp(c));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ gestion des comptes (admin)
authRoutes.get("/users", requireUser, requireAdmin, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.active, u.created_at,
       (SELECT COUNT(*) FROM devices d WHERE d.owner_user_id = u.id AND d.status IN ('actif','perdu')) AS devices
     FROM users u ORDER BY u.name`).all();
  return c.json(results);
});

authRoutes.post("/users", requireUser, requireAdmin, async (c) => {
  const b = await c.req.json<{ email: string; name: string; role: "admin" | "user"; password: string }>();
  if (!["admin", "user"].includes(b.role)) throw new HttpError(422, "Rôle invalide");
  const problems = passwordProblems(b.password ?? "");
  if (problems.length) throw new HttpError(422, "Mot de passe trop faible : " + problems.join(", "));
  const row = await c.env.DB.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?) RETURNING id")
    .bind(b.email.toLowerCase(), b.name, b.role, await hashPassword(b.password)).first<{ id: number }>()
    .catch(() => { throw new HttpError(409, "Cette adresse existe déjà"); });
  await audit(c.env, c.get("user").email, "creation_compte", b.email, `rôle ${b.role}`, clientIp(c));
  return c.json({ id: row!.id }, 201);
});

authRoutes.patch("/users/:id", requireUser, requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  const b = await c.req.json<{ role?: string; active?: boolean; name?: string; password?: string }>();
  if (id === c.get("user").id && (b.active === false || b.role === "user"))
    throw new HttpError(409, "Vous ne pouvez pas retirer vos propres droits");
  if (b.role && !["admin", "user"].includes(b.role)) throw new HttpError(422, "Rôle invalide");
  if (b.role) await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(b.role, id).run();
  if (b.active !== undefined) await c.env.DB.prepare("UPDATE users SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, id).run();
  if (b.name) await c.env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(b.name, id).run();
  if (b.password) {
    const problems = passwordProblems(b.password);
    if (problems.length) throw new HttpError(422, "Mot de passe trop faible : " + problems.join(", "));
    await c.env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(b.password), id).run();
  }
  await audit(c.env, c.get("user").email, "modification_compte", String(id), JSON.stringify({ ...b, password: b.password ? "***" : undefined }), clientIp(c));
  return c.json({ ok: true });
});

// ------------------------------------------------------------------ RGPD
/** Droit d'accès et à la portabilité (art. 15 et 20) : export des données de la personne connectée. */
authRoutes.get("/me/export", requireUser, async (c) => {
  const u = c.get("user");
  const { results: devices } = await c.env.DB.prepare(
    "SELECT id, name, platform, model, os_version, ownership, status, enrolled_at, last_seen FROM devices WHERE owner_user_id = ?",
  ).bind(u.id).all<any>();
  for (const d of devices) {
    d.positions = await lastLocations(c.env, d.id, 500);
    d.commandes = (await c.env.DB.prepare("SELECT type, status, created_by, reason, created_at FROM commands WHERE device_id = ?")
      .bind(d.id).all()).results;
  }
  const { results: journal } = await c.env.DB.prepare("SELECT at, action, target FROM audit_log WHERE actor = ? ORDER BY at DESC LIMIT 1000")
    .bind(u.email).all();
  await audit(c.env, u.email, "export_rgpd", "", "", clientIp(c));
  return c.json({ genere_le: new Date().toISOString(), personne: u, appareils: devices, journal });
});

/** Droit à l'effacement (art. 17) : anonymise le compte et supprime les positions de ses appareils. */
authRoutes.post("/users/:id/anonymize", requireUser, requireAdmin, async (c) => {
  const id = Number(c.req.param("id"));
  if (id === c.get("user").id) throw new HttpError(409, "Impossible d'anonymiser votre propre compte");
  const { reason } = await c.req.json<{ reason?: string }>().catch(() => ({ reason: "" }));
  const user = await c.env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(id).first<{ email: string }>();
  if (!user) throw new HttpError(404, "Compte introuvable");
  const anon = `anonyme-${id}@supprime.invalid`;
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM locations WHERE device_id IN (SELECT id FROM devices WHERE owner_user_id = ?)").bind(id),
    c.env.DB.prepare("UPDATE devices SET owner_user_id = NULL WHERE owner_user_id = ?").bind(id),
    c.env.DB.prepare("UPDATE users SET email = ?, name = 'Compte anonymisé', active = 0, password_hash = 'x' WHERE id = ?").bind(anon, id),
    c.env.DB.prepare("UPDATE audit_log SET actor = ? WHERE actor = ?").bind(anon, user.email),
  ]);
  await audit(c.env, c.get("user").email, "anonymisation_rgpd", anon, reason ?? "", clientIp(c));
  return c.json({ ok: true });
});
