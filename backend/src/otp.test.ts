import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { diditVerifier, requestOtp, verifyOtp, type PhoneVerifier } from "./otp.js";

type Row = { id: number; phone: string; codeHash: string; expiresAt: Date; createdAt: Date; attempts: number; consumedAt: Date | null };

// Juste ce que otp.ts lit et écrit dans OtpCode.
function fakePrisma() {
  const rows: Row[] = [];
  const otpCode = {
    async findMany({ where }: { where: { phone: string; createdAt: { gte: Date } } }) {
      return rows.filter((r) => r.phone === where.phone && r.createdAt >= where.createdAt.gte).sort((a, b) => +b.createdAt - +a.createdAt);
    },
    async findFirst({ where }: { where: { phone: string } }) {
      return rows.filter((r) => r.phone === where.phone && !r.consumedAt).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null;
    },
    async create({ data }: { data: Pick<Row, "phone" | "codeHash" | "expiresAt"> }) {
      const row = { id: rows.length + 1, createdAt: new Date(), attempts: 0, consumedAt: null, ...data };
      rows.push(row);
      return row;
    },
    async update({ where, data }: { where: { id: number }; data: { attempts: number | { increment: number } } }) {
      const row = rows.find((r) => r.id === where.id)!;
      row.attempts = typeof data.attempts === "number" ? data.attempts : row.attempts + data.attempts.increment;
      return row;
    },
    async updateMany({ where, data }: { where: { phone: string }; data: { consumedAt: Date } }) {
      for (const r of rows) if (r.phone === where.phone && !r.consumedAt) r.consumedAt = data.consumedAt;
    },
  };
  return { rows, prisma: { otpCode } as unknown as PrismaClient };
}

const PHONE = "+22890112233";

function fakeVerifier(sendResult: Awaited<ReturnType<PhoneVerifier["send"]>>, checks: Awaited<ReturnType<PhoneVerifier["check"]>>[]): PhoneVerifier {
  return { ttlMs: 5 * 60_000, maxAttempts: 3, send: async () => sendResult, check: async () => checks.shift() ?? "approved" };
}

describe("codes avec fournisseur", () => {
  it("envoie, compte les essais ratés puis accepte le bon code", async () => {
    const { prisma, rows } = fakePrisma();
    const cfg = { secret: "s", devCodes: false, verifier: fakeVerifier("sent", ["wrong", "approved"]) };
    const sent = await requestOtp(prisma, cfg, PHONE, PHONE, "indispo");
    expect(sent).toEqual({ ok: true, body: { phone: PHONE, expiresInMinutes: 5 } });
    expect(rows[0].codeHash).toBe("");

    const wrong = await verifyOtp(prisma, cfg, PHONE, PHONE, "000000");
    expect(wrong).toMatchObject({ ok: false, status: 400, body: { error: "Code incorrect. Encore 2 essais." } });
    expect(await verifyOtp(prisma, cfg, PHONE, PHONE, "123456")).toEqual({ ok: true });
    expect(rows[0].consumedAt).not.toBeNull();
  });

  it("refuse un nouvel envoi avant une minute", async () => {
    const { prisma } = fakePrisma();
    const cfg = { secret: "s", devCodes: false, verifier: fakeVerifier("sent", []) };
    await requestOtp(prisma, cfg, PHONE, PHONE, "indispo");
    expect(await requestOtp(prisma, cfg, PHONE, PHONE, "indispo")).toMatchObject({ ok: false, status: 429 });
  });

  it("numéro refusé ou fournisseur en panne", async () => {
    const { prisma, rows } = fakePrisma();
    expect(await requestOtp(prisma, { secret: "s", devCodes: false, verifier: fakeVerifier("invalid", []) }, PHONE, PHONE, "x")).toMatchObject({
      ok: false,
      status: 400,
    });
    const broken: PhoneVerifier = { ...fakeVerifier("sent", []), send: async () => Promise.reject(new Error("down")) };
    expect(await requestOtp(prisma, { secret: "s", devCodes: false, verifier: broken }, PHONE, PHONE, "x")).toMatchObject({ ok: false, status: 502 });
    expect(rows).toHaveLength(0);
  });

  it("bloque après un refus du fournisseur", async () => {
    const { prisma } = fakePrisma();
    const cfg = { secret: "s", devCodes: false, verifier: fakeVerifier("sent", ["declined"]) };
    await requestOtp(prisma, cfg, PHONE, PHONE, "x");
    expect(await verifyOtp(prisma, cfg, PHONE, PHONE, "1")).toMatchObject({ ok: false, status: 429 });
    expect(await verifyOtp(prisma, cfg, PHONE, PHONE, "1")).toMatchObject({ ok: false, status: 429 });
  });
});

describe("codes sans fournisseur", () => {
  it("indisponible hors mode test", async () => {
    const { prisma } = fakePrisma();
    expect(await requestOtp(prisma, { secret: "s", devCodes: false }, PHONE, PHONE, "indispo")).toEqual({
      ok: false,
      status: 503,
      body: { error: "indispo" },
    });
  });

  it("en mode test, le code renvoyé est accepté", async () => {
    const { prisma } = fakePrisma();
    const cfg = { secret: "s", devCodes: true };
    const sent = await requestOtp(prisma, cfg, `driver:${PHONE}`, PHONE, "indispo");
    if (!sent.ok) throw new Error("envoi refusé");
    expect(await verifyOtp(prisma, cfg, `driver:${PHONE}`, PHONE, String(sent.body.devCode))).toEqual({ ok: true });
  });
});

describe("diditVerifier", () => {
  function fetcherFor(status: number, body: unknown, calls: { url: string; init: RequestInit }[] = []) {
    return (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
  }

  it("envoie le numéro avec la clé", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    expect(await diditVerifier("k", fetcherFor(200, { status: "Success" }, calls)).send(PHONE)).toBe("sent");
    expect(calls[0].url).toBe("https://verification.didit.me/v3/phone/send/");
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ phone_number: PHONE, options: { preferred_channel: "sms" } });
  });

  it("traduit les réponses d'envoi", async () => {
    expect(await diditVerifier("k", fetcherFor(200, { status: "Blocked" })).send(PHONE)).toBe("blocked");
    expect(await diditVerifier("k", fetcherFor(400, {})).send(PHONE)).toBe("invalid");
    expect(await diditVerifier("k", fetcherFor(429, {})).send(PHONE)).toBe("blocked");
    await expect(diditVerifier("k", fetcherFor(403, {})).send(PHONE)).rejects.toThrow("didit send 403");
  });

  it("traduit les réponses de vérification", async () => {
    expect(await diditVerifier("k", fetcherFor(200, { status: "Approved" })).check(PHONE, "1")).toBe("approved");
    expect(await diditVerifier("k", fetcherFor(200, { status: "Failed" })).check(PHONE, "1")).toBe("wrong");
    expect(await diditVerifier("k", fetcherFor(200, { status: "Declined" })).check(PHONE, "1")).toBe("declined");
    expect(await diditVerifier("k", fetcherFor(200, { status: "Expired or Not Found" })).check(PHONE, "1")).toBe("expired");
    await expect(diditVerifier("k", fetcherFor(502, {})).check(PHONE, "1")).rejects.toThrow("didit check 502");
  });
});
