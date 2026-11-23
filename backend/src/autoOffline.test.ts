import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { OFFLINE_AFTER_MS, OFFLINE_AFTER_REACHABLE_MS, RESTORE_ONLINE_WITHIN_MS, shouldRestoreOnline, silenceLimitMs } from "./driver.js";
import { autoOffline, driverLifeSign } from "./routes/driverApp.js";

type Row = { id: string; online: boolean; zedAvailable: boolean; lastSeenAt: Date | null; autoOfflineAt: Date | null; employment: string; vehicle: string };
type Where = Record<string, unknown> & { id?: string; online?: boolean; zedAvailable?: boolean; autoOfflineAt?: Date | null; OR?: { lastSeenAt: null | { lt: Date } }[] };

function matches(r: Row, w: Where) {
  if (w.id !== undefined && r.id !== w.id) return false;
  if (w.online !== undefined && r.online !== w.online) return false;
  if (w.zedAvailable !== undefined && r.zedAvailable !== w.zedAvailable) return false;
  if ("autoOfflineAt" in w && (r.autoOfflineAt?.getTime() ?? null) !== (w.autoOfflineAt?.getTime() ?? null)) return false;
  if (w.OR && !w.OR.some((c) => (c.lastSeenAt === null ? r.lastSeenAt === null : r.lastSeenAt !== null && r.lastSeenAt < c.lastSeenAt.lt))) return false;
  return true;
}

function fakePrisma(rows: Row[], pushSubjects: string[] = []) {
  const prisma = {
    driver: {
      findMany: async ({ where }: { where: Where }) => rows.filter((r) => matches(r, where)).map((r) => ({ ...r, motorbike: null })),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = rows.find((x) => x.id === where.id);
        return r ? { ...r, motorbike: null } : null;
      },
      updateMany: async ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hit = rows.filter((r) => matches(r, where));
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
    },
    pushSubscription: {
      findMany: async ({ where }: { where: { subject: { in: string[] } } }) => pushSubjects.filter((s) => where.subject.in.includes(s)).map((subject) => ({ subject })),
    },
    settings: { findFirst: async () => ({ id: 1, leaseBlockDays: 0 }) },
    leaseContract: { findMany: async () => [] },
    motorbike: { count: async () => 0 },
  } as unknown as PrismaClient;
  return prisma;
}

const now = new Date("2026-11-23T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const driver = (id: string, lastSeenAt: Date | null, extra: Partial<Row> = {}): Row => ({ id, online: true, zedAvailable: false, lastSeenAt, autoOfflineAt: null, employment: "FREELANCE", vehicle: "MOTO", ...extra });

describe("passage automatique hors ligne du livreur", () => {
  it("laisse beaucoup plus longtemps en ligne un livreur joignable par alerte (téléphone en veille)", () => {
    expect(silenceLimitMs(true)).toBe(OFFLINE_AFTER_REACHABLE_MS);
    expect(silenceLimitMs(false)).toBe(OFFLINE_AFTER_MS);
    expect(OFFLINE_AFTER_REACHABLE_MS).toBeGreaterThan(OFFLINE_AFTER_MS);
  });

  it("garde en ligne le livreur joignable silencieux depuis 1 h, met hors ligne celui sans alertes", async () => {
    const rows = [driver("joignable", ago(60 * 60_000)), driver("muet", ago(60 * 60_000)), driver("actif", ago(60_000))];
    const count = await autoOffline(fakePrisma(rows, ["joignable"]), now);
    expect(count).toBe(1);
    expect(rows.map((r) => r.online)).toEqual([true, false, true]);
    expect(rows[1].autoOfflineAt).toEqual(now);
  });

  it("met hors ligne même un livreur joignable après 4 h de silence", async () => {
    const rows = [driver("joignable", ago(OFFLINE_AFTER_REACHABLE_MS + 60_000))];
    await autoOffline(fakePrisma(rows, ["joignable"]), now);
    expect(rows[0].online).toBe(false);
  });
});

describe("remise en ligne au réveil de l'application", () => {
  it("seulement après un passage hors ligne décidé par le serveur, récent", () => {
    expect(shouldRestoreOnline(null, now)).toBe(false);
    expect(shouldRestoreOnline(ago(10 * 60_000), now)).toBe(true);
    expect(shouldRestoreOnline(ago(RESTORE_ONLINE_WITHIN_MS + 1), now)).toBe(false);
  });

  it("remet en ligne le livreur mis hors ligne par le serveur dès que l'application parle", async () => {
    const at = ago(20 * 60_000);
    const rows = [driver("d1", ago(60 * 60_000), { online: false, autoOfflineAt: at })];
    expect(await driverLifeSign(fakePrisma(rows), "d1", at, now)).toBe(true);
    expect(rows[0]).toMatchObject({ online: true, autoOfflineAt: null, lastSeenAt: now });
  });

  it("ne remet pas en ligne un livreur qui s'est mis hors ligne lui-même", async () => {
    const rows = [driver("d1", ago(60 * 60_000), { online: false })];
    expect(await driverLifeSign(fakePrisma(rows), "d1", null, now)).toBe(false);
    expect(rows[0]).toMatchObject({ online: false, lastSeenAt: now });
  });

  it("trop tard (le lendemain) : reste hors ligne, la marque est effacée", async () => {
    const at = ago(RESTORE_ONLINE_WITHIN_MS + 60_000);
    const rows = [driver("d1", at, { online: false, autoOfflineAt: at })];
    expect(await driverLifeSign(fakePrisma(rows), "d1", at, now)).toBe(false);
    expect(rows[0]).toMatchObject({ online: false, autoOfflineAt: null });
  });
});
