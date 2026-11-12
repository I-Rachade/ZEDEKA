import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Notifier, PushPayload } from "./notify.js";
import { autoDispatch } from "./autoDispatch.js";
import { busyOrderWhere, isReservation, isSlotOffer, offerTimeoutMs, releaseSlot, runScheduledPickups, slotClash } from "./scheduledPickup.js";

const now = new Date("2026-11-12T14:00:00Z");
const min = (n: number) => new Date(now.getTime() + n * 60_000);

type Push = { role: string; id: string; p: PushPayload };
function fakeNotifier() {
  const pushes: Push[] = [];
  const staff: PushPayload[] = [];
  const notifier = {
    push: async (role: string, id: string, p: PushPayload) => void pushes.push({ role, id, p }),
    staff: async (_team: string, p: PushPayload) => void staff.push(p),
  } as unknown as Notifier;
  return { notifier, pushes, staff };
}

describe("réservation de créneau : règles", () => {
  it("une proposition faite plus de 30 min avant le retrait est une réservation", () => {
    expect(isSlotOffer(min(90), now)).toBe(true);
    expect(isSlotOffer(min(30), now)).toBe(false);
    expect(isSlotOffer(null, now)).toBe(false);
  });

  it("3 min pour accepter une réservation, 60 s pour une course normale", () => {
    expect(offerTimeoutMs(min(90), now, 180)).toBe(180_000);
    expect(offerTimeoutMs(min(20), now, 180)).toBe(60_000);
    expect(offerTimeoutMs(null, now)).toBe(60_000);
  });

  it("pas deux retraits réservés à moins d'une heure d'écart", () => {
    expect(slotClash([min(100)], min(120))).toBe(true);
    expect(slotClash([min(60), null], min(120))).toBe(false);
  });

  it("un retrait réservé lointain ne rend pas le livreur occupé (OR explicite sur pickupAt vide)", () => {
    const w = busyOrderWhere(now);
    expect(w.OR).toContainEqual({ pickupAt: null });
    expect(w.OR).toContainEqual({ pickupAt: { lte: min(45) } });
  });

  it("réservation = acceptée par le livreur actuel plus de 30 min avant", () => {
    expect(isReservation({ pickupAt: min(20), driverId: "d1", assignments: [{ driverId: "d1", createdAt: min(-60) }] })).toBe(true);
    expect(isReservation({ pickupAt: min(20), driverId: "d1", assignments: [{ driverId: "d1", createdAt: min(-5) }] })).toBe(false);
    expect(isReservation({ pickupAt: min(20), driverId: "d2", assignments: [{ driverId: "d1", createdAt: min(-60) }] })).toBe(false);
  });
});

type Row = {
  id: string;
  code: string;
  customerId: string | null;
  pickupAt: Date | null;
  driverId: string | null;
  slotReminderAt?: Date | null;
  slotConfirmedAt: Date | null;
  slotStartedAt?: Date | null;
  status?: string;
  driver: { name: string; online: boolean } | null;
  assignments: { driverId: string; createdAt: Date }[];
};

// Base minimale : findMany renvoie les commandes selon la fenêtre demandée, updateMany applique et compte.
function fakeDb(rows: Row[]) {
  const withdrawn: { orderId: string; reason: string }[] = [];
  const inWindow = (r: Row, w: { gt?: Date; lte?: Date }) => !!r.pickupAt && (!w.gt || r.pickupAt > w.gt) && (!w.lte || r.pickupAt <= w.lte);
  const prisma = {
    order: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => {
          if (!r.driverId || !inWindow(r, where.pickupAt as { gt?: Date; lte?: Date })) return false;
          if ("slotReminderAt" in where && r.slotReminderAt) return false;
          if ("slotConfirmedAt" in where && r.slotConfirmedAt) return false;
          if ("slotStartedAt" in where && r.slotStartedAt) return false;
          return true;
        }),
      findUnique: async ({ where }: { where: { id: string } }) => {
        const r = rows.find((x) => x.id === where.id);
        return r && { ...r, status: r.status ?? "PENDING" };
      },
      updateMany: async ({ where, data }: { where: { id: string; driverId?: string }; data: Partial<Row> }) => {
        const r = rows.find((x) => x.id === where.id && (!where.driverId || x.driverId === where.driverId));
        if (!r) return { count: 0 };
        Object.assign(r, data);
        return { count: 1 };
      },
    },
    driverAssignment: {
      updateMany: async ({ where, data }: { where: { orderId: string }; data: { reason: string } }) => {
        withdrawn.push({ orderId: where.orderId, reason: data.reason });
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, withdrawn };
}

const reserved = (over: Partial<Row>): Row => ({
  id: "o1",
  code: "ZC-1",
  customerId: "c1",
  pickupAt: min(40),
  driverId: "d1",
  slotConfirmedAt: null,
  driver: { name: "Kofi Mensah", online: true },
  assignments: [{ driverId: "d1", createdAt: min(-80) }],
  ...over,
});

describe("réservation de créneau : tâche de chaque minute", () => {
  it("45 min avant : rappel au livreur réservé, une seule fois", async () => {
    const row = reserved({});
    const { prisma } = fakeDb([row]);
    const { notifier, pushes } = fakeNotifier();
    expect((await runScheduledPickups(prisma, notifier, now)).reminded).toBe(1);
    expect(pushes[0]).toMatchObject({ role: "driver", id: "d1" });
    expect(pushes[0].p.title).toContain("14:40");
    expect((await runScheduledPickups(prisma, notifier, now)).reminded).toBe(0);
  });

  it("30 min avant, confirmé et en ligne : la course démarre pour lui", async () => {
    const row = reserved({ pickupAt: min(25), slotReminderAt: min(-20), slotConfirmedAt: min(-15) });
    const { prisma, withdrawn } = fakeDb([row]);
    const { notifier, pushes } = fakeNotifier();
    const r = await runScheduledPickups(prisma, notifier, now);
    expect(r).toMatchObject({ started: 1, dropped: 0 });
    expect(row.slotStartedAt).toEqual(now);
    expect(row.driverId).toBe("d1");
    expect(withdrawn).toHaveLength(0);
    expect(pushes.some((p) => p.p.title.startsWith("C'est l'heure"))).toBe(true);
  });

  it("30 min avant sans confirmation : retirée, l'équipe et le client sont prévenus", async () => {
    const row = reserved({ pickupAt: min(25), slotReminderAt: min(-20) });
    const { prisma, withdrawn } = fakeDb([row]);
    const { notifier, pushes, staff } = fakeNotifier();
    const r = await runScheduledPickups(prisma, notifier, now);
    expect(r.dropped).toBe(1);
    expect(row.driverId).toBeNull();
    expect(withdrawn[0].reason).toBe("Pas de confirmation 30 min avant");
    expect(staff[0].title).toContain("Créneau non tenu");
    expect(pushes.some((p) => p.role === "customer" && p.p.body.includes("autre livreur"))).toBe(true);
  });

  it("confirmé mais hors ligne à l'heure : retirée aussi", async () => {
    const row = reserved({ pickupAt: min(25), slotConfirmedAt: min(-15), driver: { name: "Kofi", online: false } });
    const { prisma, withdrawn } = fakeDb([row]);
    const { notifier } = fakeNotifier();
    expect((await runScheduledPickups(prisma, notifier, now)).dropped).toBe(1);
    expect(withdrawn[0].reason).toBe("Hors ligne à l'heure du retrait");
  });

  it("course attribuée dans les 30 dernières minutes : ni rappel ni retrait", async () => {
    const row = reserved({ pickupAt: min(25), assignments: [{ driverId: "d1", createdAt: min(-2) }] });
    const { prisma, withdrawn } = fakeDb([row]);
    const { notifier, pushes } = fakeNotifier();
    expect(await runScheduledPickups(prisma, notifier, now)).toMatchObject({ started: 0, dropped: 0 });
    expect(row.driverId).toBe("d1");
    expect(row.slotStartedAt).toEqual(now);
    expect(withdrawn).toHaveLength(0);
    expect(pushes).toHaveLength(0);
  });
});

describe("réservation de créneau : désistement", () => {
  it("libre jusqu'à 1 h avant", async () => {
    const row = reserved({ pickupAt: min(90) });
    const { prisma } = fakeDb([row]);
    const { notifier, staff } = fakeNotifier();
    expect(await releaseSlot(prisma, notifier, "o1", "d1", now)).toBe("OK");
    expect(row.driverId).toBeNull();
    expect(staff[0].title).toContain("Désistement");
  });

  it("refusé à moins d'1 h, et pour un autre livreur", async () => {
    const { prisma } = fakeDb([reserved({ pickupAt: min(50) })]);
    const { notifier } = fakeNotifier();
    expect(await releaseSlot(prisma, notifier, "o1", "d1", now)).toBe("TOO_LATE");
    expect(await releaseSlot(prisma, notifier, "o1", "d2", now)).toBe("NOT_FOUND");
  });
});

describe("réservation de créneau : attribution automatique", () => {
  function dispatchDb(order: Record<string, unknown>, drivers: Record<string, unknown>[]) {
    const offered: { orderId: string; driverId: string }[] = [];
    let orderWhere: Record<string, unknown> = {};
    const prisma = {
      settings: { findUnique: async () => ({ autoDispatchEnabled: true, autoDispatchMaxTries: 3, slotOfferLeadMinutes: 120, slotOfferSeconds: 180 }) },
      order: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          orderWhere = where;
          return [order];
        },
        updateMany: async ({ where, data }: { where: { id: string }; data: { driverId?: string } }) => {
          if (data.driverId) offered.push({ orderId: where.id, driverId: data.driverId });
          return { count: 1 };
        },
        findUnique: async () => ({ pickupAt: order.pickupAt }),
      },
      driver: { findMany: async () => drivers, findUnique: async () => ({ employment: "FREELANCE" }) },
      driverAssignment: { updateMany: async () => ({ count: 0 }), create: async () => ({}) },
    } as unknown as PrismaClient;
    return { prisma, offered, where: () => orderWhere };
  }
  const order = (over: Record<string, unknown>) => ({
    id: "o1",
    code: "ZC-1",
    zoneId: "z1",
    latitude: null,
    longitude: null,
    pickupLatitude: 6.13,
    pickupLongitude: 1.22,
    pickupAt: min(90),
    restaurant: null,
    assignments: [],
    ...over,
  });
  const driver = (id: string, reservedAt: Date[] = []) => ({ id, zoneId: "z1", lastLatitude: 6.13, lastLongitude: 1.22, lastLocationAt: min(-1), orders: reservedAt.map((pickupAt) => ({ pickupAt })) });

  it("propose un retrait programmé dès 2 h avant, en réservation (message et délai de 3 min)", async () => {
    const { prisma, offered, where } = dispatchDb(order({}), [driver("d1")]);
    const { notifier, pushes } = fakeNotifier();
    expect(await autoDispatch(prisma, notifier, now)).toBe(1);
    expect(offered).toEqual([{ orderId: "o1", driverId: "d1" }]);
    expect(JSON.stringify(where().AND)).toContain(min(120).toISOString());
    expect(pushes[0].p.title).toBe("Retrait programmé ZC-1 à 15:30");
    expect(pushes[0].p.body).toContain("3 min");
  });

  it("saute le livreur qui a déjà un retrait réservé à moins d'1 h", async () => {
    const { prisma, offered } = dispatchDb(order({}), [driver("d1", [min(60)]), driver("d2", [min(200)])]);
    await autoDispatch(prisma, fakeNotifier().notifier, now);
    expect(offered).toEqual([{ orderId: "o1", driverId: "d2" }]);
  });

  it("à 30 min, la répartition normale reprend même après 3 essais de réservation", async () => {
    const tries = ["a", "b", "c"].map((d) => ({ driverId: d, assignedBy: "Attribution automatique", createdAt: min(-60) }));
    const { prisma, offered } = dispatchDb(order({ pickupAt: min(25), assignments: tries }), [driver("a")]);
    const { notifier, pushes } = fakeNotifier();
    expect(await autoDispatch(prisma, notifier, now)).toBe(1);
    // « a » avait refusé la réservation : il peut recevoir la course normale.
    expect(offered).toEqual([{ orderId: "o1", driverId: "a" }]);
    expect(pushes[0].p.title).toBe("Nouvelle course ZC-1");
  });

  it("après 3 essais de réservation, plus de proposition avant les 30 dernières minutes", async () => {
    const tries = ["a", "b", "c"].map((d) => ({ driverId: d, assignedBy: "Attribution automatique", createdAt: min(-10) }));
    const { prisma, offered } = dispatchDb(order({ assignments: tries }), [driver("d1")]);
    expect(await autoDispatch(prisma, fakeNotifier().notifier, now)).toBe(0);
    expect(offered).toHaveLength(0);
  });
});
