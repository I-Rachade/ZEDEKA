import type { PrismaClient } from "@prisma/client";
import { hashOtp, newOtpCode, OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, OTP_RESEND_DELAY_MS, OTP_TTL_MS } from "./customer.js";

// Codes de connexion par téléphone (clients et livreurs).
// Avec un fournisseur (Didit, comme poinderecharge), c'est lui qui crée, envoie et vérifie le code ;
// on garde ici les limites d'envoi et le suivi des essais. Sans fournisseur, le code est créé ici
// et seulement renvoyé dans la réponse en mode test (OTP_DEV_CODES).
export interface PhoneVerifier {
  /** Validité du code et nombre d'essais permis chez le fournisseur. */
  ttlMs: number;
  maxAttempts: number;
  send(phone: string): Promise<"sent" | "blocked" | "invalid">;
  check(phone: string, code: string): Promise<"approved" | "wrong" | "declined" | "expired">;
}

export type OtpConfig = { secret: string; devCodes: boolean; verifier?: PhoneVerifier };

type Failure = { status: number; body: Record<string, unknown> };
export type RequestResult = { ok: true; body: Record<string, unknown> } | ({ ok: false } & Failure);
export type VerifyResult = { ok: true } | ({ ok: false } & Failure);

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, status, body: { error, ...extra } });
const wrongCode = (left: number) =>
  fail(400, left > 0 ? `Code incorrect. Encore ${left} essai${left > 1 ? "s" : ""}.` : "Trop d'essais. Demandez un nouveau code.");
const SEND_FAILED = "L'envoi du code a échoué. Réessayez dans un instant.";

/**
 * Envoie un code au numéro `phone`. `key` range le suivi dans OtpCode (le numéro, préfixé pour les livreurs).
 * `unavailable` est le message affiché quand aucun envoi n'est possible.
 */
export async function requestOtp(prisma: PrismaClient, cfg: OtpConfig, key: string, phone: string, unavailable: string): Promise<RequestResult> {
  const now = Date.now();
  const recent = await prisma.otpCode.findMany({
    where: { phone: key, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const last = recent[0]?.createdAt.getTime();
  if (last && now - last < OTP_RESEND_DELAY_MS) {
    const wait = Math.ceil((OTP_RESEND_DELAY_MS - (now - last)) / 1000);
    return fail(429, `Patientez ${wait} s avant de demander un nouveau code`, { retryIn: wait });
  }
  if (recent.length >= OTP_MAX_PER_HOUR) return fail(429, "Trop de codes demandés. Réessayez dans une heure.");

  if (cfg.verifier) {
    let sent: Awaited<ReturnType<PhoneVerifier["send"]>>;
    try {
      sent = await cfg.verifier.send(phone);
    } catch (err) {
      console.error("envoi du code", err);
      return fail(502, SEND_FAILED);
    }
    if (sent === "invalid") return fail(400, "Ce numéro ne peut pas recevoir de SMS.");
    if (sent === "blocked") return fail(429, "Trop de codes demandés. Réessayez dans une heure.");
    // Le code est chez le fournisseur : la ligne ne sert qu'aux limites d'envoi et d'essais.
    await prisma.otpCode.create({ data: { phone: key, codeHash: "", expiresAt: new Date(now + cfg.verifier.ttlMs) } });
    return { ok: true, body: { phone, expiresInMinutes: Math.round(cfg.verifier.ttlMs / 60_000) } };
  }

  if (!cfg.devCodes) return fail(503, unavailable);
  const code = newOtpCode();
  await prisma.otpCode.create({ data: { phone: key, codeHash: hashOtp(key, code, cfg.secret), expiresAt: new Date(now + OTP_TTL_MS) } });
  return { ok: true, body: { phone, expiresInMinutes: OTP_TTL_MS / 60_000, devCode: code } };
}

/** Vérifie le code ; en cas de succès, tous les codes en cours pour `key` sont consommés. */
export async function verifyOtp(prisma: PrismaClient, cfg: OtpConfig, key: string, phone: string, code: string): Promise<VerifyResult> {
  const maxAttempts = cfg.verifier?.maxAttempts ?? OTP_MAX_ATTEMPTS;
  const otp = await prisma.otpCode.findFirst({ where: { phone: key, consumedAt: null }, orderBy: { createdAt: "desc" } });
  if (!otp || otp.expiresAt.getTime() < Date.now()) return fail(400, "Code expiré. Demandez-en un nouveau.");
  if (otp.attempts >= maxAttempts) return fail(429, "Trop d'essais. Demandez un nouveau code.");

  if (cfg.verifier) {
    let checked: Awaited<ReturnType<PhoneVerifier["check"]>>;
    try {
      checked = await cfg.verifier.check(phone, code);
    } catch (err) {
      console.error("vérification du code", err);
      return fail(502, "Vérification impossible pour le moment. Réessayez dans un instant.");
    }
    if (checked === "expired") return fail(400, "Code expiré. Demandez-en un nouveau.");
    if (checked === "declined") {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: maxAttempts } });
      return fail(429, "Trop d'essais. Demandez un nouveau code.");
    }
    if (checked === "wrong") {
      const { attempts } = await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return wrongCode(maxAttempts - attempts);
    }
  } else if (otp.codeHash !== hashOtp(key, code, cfg.secret)) {
    const { attempts } = await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return wrongCode(maxAttempts - attempts);
  }

  await prisma.otpCode.updateMany({ where: { phone: key, consumedAt: null }, data: { consumedAt: new Date() } });
  return { ok: true };
}

// Didit (https://docs.didit.me) : POST /v3/phone/send/ puis /v3/phone/check/ avec le même numéro.
const DIDIT_API = "https://verification.didit.me/v3/phone";

export function diditVerifier(
  apiKey: string,
  // Appelé à travers une fonction : le fetch du runtime ne doit pas être détaché de son contexte.
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): PhoneVerifier {
  async function post(path: "send" | "check", body: unknown) {
    const res = await fetcher(`${DIDIT_API}/${path}/`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, data };
  }

  return {
    // Didit garde le code 5 minutes après l'envoi et accepte 3 essais.
    ttlMs: 5 * 60 * 1000,
    maxAttempts: 3,
    async send(phone) {
      const { status, data } = await post("send", { phone_number: phone, options: { code_size: 6, locale: "fr", preferred_channel: "sms" } });
      if (status === 400) return "invalid";
      if (status === 429) return "blocked";
      if (status !== 200) throw new Error(`didit send ${status} ${JSON.stringify(data)}`);
      return data.status === "Blocked" ? "blocked" : "sent";
    },
    async check(phone, code) {
      const { status, data } = await post("check", { phone_number: phone, code });
      if (status === 429) return "declined";
      if (status !== 200) throw new Error(`didit check ${status} ${JSON.stringify(data)}`);
      if (data.status === "Approved") return "approved";
      if (data.status === "Failed") return "wrong";
      if (data.status === "Declined") return "declined";
      return "expired";
    },
  };
}
