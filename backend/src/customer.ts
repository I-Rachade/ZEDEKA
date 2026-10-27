import { createHmac, randomInt } from "node:crypto";

// Codes de connexion : 6 chiffres, valables 10 minutes, 5 essais par code.
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
// Limites d'envoi par numéro.
export const OTP_RESEND_DELAY_MS = 60 * 1000;
export const OTP_MAX_PER_HOUR = 5;

// Numéro togolais au format +228XXXXXXXX (8 chiffres après l'indicatif), sinon null.
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00228")) digits = digits.slice(5);
  else if (digits.startsWith("228") && digits.length === 11) digits = digits.slice(3);
  return /^[2-9]\d{7}$/.test(digits) ? `+228${digits}` : null;
}

// Les commandes passées sans compte stockent le numéro tel que saisi : on compare les 8 derniers chiffres.
export const phoneTail = (normalized: string) => normalized.slice(-8);

export function newOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(phone: string, code: string, secret: string): string {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Zone dont le nom cite le quartier, ex. « Zone 1 – Centre (Tokoin, Bè, Nyékonakpoè) » pour « tokoin casablanca ».
export function guessZone<Z extends { id: string; name: string }>(zones: Z[], quarter: string): Z | null {
  const q = fold(quarter);
  if (!q) return null;
  for (const zone of zones) {
    const listed = fold(zone.name.match(/\(([^)]*)\)/)?.[1] ?? zone.name.split(/[–-]/).slice(1).join(" ") ?? zone.name)
      .split(" ")
      .filter((w) => w.length >= 2);
    if (listed.some((w) => q.split(" ").includes(w))) return zone;
  }
  return null;
}
