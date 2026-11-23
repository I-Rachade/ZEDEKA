/**
 * Code de déblocage de l'agent (quitter la gestion, retirer la protection) :
 * code à 8 chiffres = HMAC-SHA256(secret de l'appareil, "unlock:<heure>"), comme un code TOTP horaire.
 * Le téléphone connaît le secret : il vérifie le code même sans réseau. Un code reste valable 2 à 3 heures.
 */
import type { Env } from "../env";
import { b64, decryptJson, encryptJson, unb64 } from "./crypto";

const HOUR = 3_600_000;
export const hourCounter = (ms = Date.now()) => Math.floor(ms / HOUR);

export async function unlockCode(secretB64: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", unb64(secretB64), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unlock:${counter}`)));
  const n = ((sig[0] << 24) >>> 0) + (sig[1] << 16) + (sig[2] << 8) + sig[3];
  return String(n % 100_000_000).padStart(8, "0");
}

/** Accepte l'heure suivante (horloge en avance) et les deux précédentes. */
export async function verifyUnlockCode(secretB64: string, code: string, now = Date.now()) {
  const clean = (code ?? "").replace(/\D/g, "");
  if (clean.length !== 8) return false;
  const c = hourCounter(now);
  for (const k of [c + 1, c, c - 1, c - 2]) if ((await unlockCode(secretB64, k)) === clean) return true;
  return false;
}

/** Secret de l'appareil, créé au besoin (appareils enrôlés avant l'arrivée du code). */
export async function deviceUnlockSecret(env: Env, device: Record<string, any>, create = true): Promise<string | null> {
  if (device.unlock_secret_enc) return decryptJson<string>(device.unlock_secret_enc, env.DATA_KEY);
  if (!create) return null;
  const secret = b64(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("UPDATE devices SET unlock_secret_enc = ? WHERE id = ?").bind(await encryptJson(secret, env.DATA_KEY), device.id).run();
  device.unlock_secret_enc = "set";
  return secret;
}
