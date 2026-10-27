import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

// Jeton simple signé HMAC : "<expiration>.<signature>". Suffisant pour un seul
// compte admin pendant le pilote ; à remplacer par de vrais comptes plus tard.

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

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

export function issueToken(secret: string, now = Date.now()): string {
  const expires = String(now + TOKEN_TTL_MS);
  return `${expires}.${sign(expires, secret)}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): boolean {
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (!safeEqual(signature, sign(expires, secret))) return false;
  return Number(expires) > now;
}

export function requireAdmin(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!secret || !verifyToken(token, secret)) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    next();
  };
}
