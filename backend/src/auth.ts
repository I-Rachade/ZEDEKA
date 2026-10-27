import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Jeton signé HMAC : "<base64url(JSON { r: rôle, s: sujet, e: expiration })>.<signature>".
// Le rôle « admin » couvre le compte unique du directeur des opérations,
// le rôle « restaurant » un compte de restaurant (sujet = id du restaurant),
// le rôle « rental » un compte de loueur de véhicules (sujet = id du loueur).

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export type Role = "admin" | "restaurant" | "rental";
type Claims = { r: Role; s: string; e: number };

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string, expected: string): boolean {
  return expected.length > 0 && safeEqual(candidate, expected);
}

export function issueToken(secret: string, now = Date.now(), role: Role = "admin", subject = "admin"): string {
  const body = Buffer.from(JSON.stringify({ r: role, s: subject, e: now + TOKEN_TTL_MS } satisfies Claims)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function readToken(token: string, secret: string, now = Date.now()): Claims | null {
  const [body, signature] = token.split(".");
  if (!body || !signature || !secret) return null;
  if (!safeEqual(signature, sign(body, secret))) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as Claims;
    return claims.e > now ? claims : null;
  } catch {
    return null;
  }
}

export function verifyToken(token: string, secret: string, now = Date.now()): boolean {
  return readToken(token, secret, now)?.r === "admin";
}

function bearer(req: Request): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export function requireAdmin(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!verifyToken(bearer(req), secret)) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    next();
  };
}

// Exige un jeton du rôle donné et place son sujet dans res.locals[key].
function requireRole(role: Role, key: string, secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const claims = readToken(bearer(req), secret);
    if (claims?.r !== role) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    res.locals[key] = claims.s;
    next();
  };
}

export const requireRestaurant = (secret: string) => requireRole("restaurant", "restaurantId", secret);
export const requireRental = (secret: string) => requireRole("rental", "providerId", secret);
