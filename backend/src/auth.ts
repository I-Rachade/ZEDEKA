import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Jeton signé HMAC : "<base64url(JSON { r: rôle, s: sujet, e: expiration })>.<signature>".
// Le rôle « admin » couvre le compte unique du directeur des opérations,
// le rôle « restaurant » un compte de restaurant (sujet = id du restaurant),
// le rôle « rental » un compte de loueur de véhicules (sujet = id du loueur),
// le rôle « customer » un client de l'application (sujet = id du client), avec une durée plus longue,
// le rôle « driver » un livreur validé (sujet = id du livreur), avec la même durée.

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const CUSTOMER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type Role = "admin" | "restaurant" | "customer" | "driver";
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

export function issueToken(secret: string, now = Date.now(), role: Role = "admin", subject = "admin", ttlMs = TOKEN_TTL_MS): string {
  const body = Buffer.from(JSON.stringify({ r: role, s: subject, e: now + ttlMs } satisfies Claims)).toString("base64url");
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

// Heure d'émission d'un jeton partenaire (durée standard), pour « se déconnecter partout ».
export function tokenIssuedAt(req: Request, secret: string): number | null {
  const claims = readToken(bearer(req), secret);
  return claims ? claims.e - TOKEN_TTL_MS : null;
}

// Jeton de client ou de livreur (durée longue) émis avant `validFrom` : refusé.
export function revokedLongToken(req: Request, secret: string, validFrom: Date | null): boolean {
  if (!validFrom) return false;
  const claims = readToken(bearer(req), secret);
  return !claims || claims.e - CUSTOMER_TOKEN_TTL_MS < validFrom.getTime();
}

export function verifyToken(token: string, secret: string, now = Date.now()): boolean {
  return readToken(token, secret, now)?.r === "admin";
}

export function bearer(req: Request): string {
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
export const requireCustomer = (secret: string) => requireRole("customer", "customerId", secret);
export const requireDriver = (secret: string) => requireRole("driver", "driverId", secret);

// Client connecté facultatif (commande possible sans compte) : id du client ou null.
export function customerFromRequest(req: Request, secret: string): string | null {
  const claims = readToken(bearer(req), secret);
  return claims?.r === "customer" ? claims.s : null;
}
