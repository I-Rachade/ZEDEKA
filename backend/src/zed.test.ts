import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { Notifier } from "./notify.js";
import { activateScheduledRides, activePlan, keepFirstOffer, nextPeriod, offerExpiresAt, rankZedDrivers, scheduleError, searchRadiusM, searchStartedAt, ZED_FRESH_POSITION_MS, zedPrice } from "./zed.js";

const now = new Date("2026-11-03T12:00:00Z");
const day = 86_400_000;
const at = (ms: number) => new Date(now.getTime() + ms);

describe("choix des conducteurs Zed", () => {
  // Client au Grand Marché de Lomé ; 0,001° de latitude ≈ 111 m.
  const client = { latitude: 6.1319, longitude: 1.2228 };
  const driver = (id: string, dLat: number, ageMs = 10_000) => ({ id, lastLatitude: client.latitude + dLat, lastLongitude: client.longitude, lastLocationAt: at(-ageMs) });

  it("classe du plus proche au plus loin, dans le rayon de 1 km seulement", () => {
    const ranked = rankZedDrivers([driver("loin", 0.008), driver("proche", 0.002), driver("dehors", 0.012), driver("moyen", 0.004)], client, 1000, now);
    expect(ranked.map((d) => d.id)).toEqual(["proche", "moyen", "loin"]);
    expect(ranked[0].distanceM).toBeGreaterThan(200);
    expect(ranked[0].distanceM).toBeLessThan(250);
  });

  it("ignore une position trop ancienne ou absente", () => {
    const stale = driver("ancien", 0.001, ZED_FRESH_POSITION_MS + 1000);
    const none = { id: "sans", lastLatitude: null, lastLongitude: null, lastLocationAt: null };
    expect(rankZedDrivers([stale, none, driver("frais", 0.003)], client, 1000, now).map((d) => d.id)).toEqual(["frais"]);
  });
});

describe("plan Zed", () => {
  const confirmed = (startMs: number, days: number) => ({ status: "CONFIRMED", startsAt: at(startMs), endsAt: at(startMs + days * day) });

  it("trouve la période en cours, et rien une fois finie", () => {
    expect(activePlan([confirmed(-10 * day, 30)], now)?.endsAt).toEqual(at(20 * day));
    expect(activePlan([confirmed(-40 * day, 30)], now)).toBeNull();
    expect(activePlan([{ status: "PENDING", startsAt: null, endsAt: null }], now)).toBeNull();
  });

  it("un paiement prolonge la période en cours, ou commence maintenant", () => {
    expect(nextPeriod([confirmed(-10 * day, 30)], 1, now)).toEqual({ startsAt: at(20 * day), endsAt: at(21 * day) });
    expect(nextPeriod([confirmed(-40 * day, 30)], 30, now)).toEqual({ startsAt: now, endsAt: at(30 * day) });
    expect(nextPeriod([], 30, now)).toEqual({ startsAt: now, endsAt: at(30 * day) });
  });

  it("l'alerte expire après le délai des réglages (15 s)", () => {
    expect(offerExpiresAt(now, 15)).toEqual(at(15_000));
  });
});

describe("courses réservées à l'avance", () => {
  const min = 60_000;

  it("accepte une heure entre 30 minutes et 7 jours plus tard", () => {
    expect(scheduleError(at(45 * min), now)).toBeNull();
    expect(scheduleError(at(7 * day - min), now)).toBeNull();
    expect(scheduleError(at(10 * min), now)).toMatch(/30 minutes/);
    expect(scheduleError(at(7 * day + min), now)).toMatch(/7 jours/);
    expect(scheduleError(new Date("pas une date"), now)).toBe("Heure invalide");
  });

  it("la recherche d'une course réservée commence 15 minutes avant l'heure", () => {
    expect(searchStartedAt({ createdAt: at(-2 * day), scheduledFor: at(20 * min) })).toEqual(at(5 * min));
    // Appel immédiat : dès la demande.
    expect(searchStartedAt({ createdAt: at(-min), scheduledFor: null })).toEqual(at(-min));
    // Réservée moins de 15 min avant (cas limite) : jamais avant la demande.
    expect(searchStartedAt({ createdAt: at(-min), scheduledFor: at(5 * min) })).toEqual(at(-min));
  });
});

describe("passage d'une course réservée à son heure", () => {
  type Row = { id: string; status: string; driverId: string | null; scheduledFor: Date };
  function fakePrisma(rows: Row[], available: string[] = ["kofi"]) {
    const pushes: string[] = [];
    const prisma = {
      zedRide: {
        findMany: async ({ where }: { where: { status: string; scheduledFor: { lte: Date } } }) =>
          rows
            .filter((r) => r.status === where.status && r.scheduledFor <= where.scheduledFor.lte)
            .map((r) => ({ ...r, customerId: "c", landmark: null, destination: "Grand marché", driver: r.driverId ? { name: "Kofi", plate: "TG-1" } : null })),
        updateMany: async ({ where, data }: { where: { id: string; status: string; driverId: string | null }; data: Partial<Row> }) => {
          const r = rows.find((x) => x.id === where.id && x.status === where.status && x.driverId === where.driverId);
          if (r) Object.assign(r, data);
          return { count: r ? 1 : 0 };
        },
        // advanceRide relit la course : on s'arrête là (aucun conducteur libre n'est simulé).
        findUnique: async () => null,
      },
      // Conducteurs encore en état de faire la course retenue (plan, disponibilité, pas d'autre client).
      driver: { count: async ({ where }: { where: { id: string } }) => (available.includes(where.id) ? 1 : 0) },
    } as unknown as PrismaClient;
    const notifier = { push: async (role: string, id: string) => void pushes.push(`${role}:${id}`) } as unknown as Notifier;
    return { prisma, notifier, pushes };
  }
  const settings = { zedRadiusM: 1000, zedOfferSeconds: 15, zedMaxOffers: 5 };

  it("15 min avant : au conducteur qui l'a retenue, sinon en recherche ; plus tard, rien ne bouge", async () => {
    const rows: Row[] = [
      { id: "retenue", status: "SCHEDULED", driverId: "kofi", scheduledFor: at(10 * 60_000) },
      { id: "libre", status: "SCHEDULED", driverId: null, scheduledFor: at(14 * 60_000) },
      { id: "demain", status: "SCHEDULED", driverId: null, scheduledFor: at(day) },
    ];
    const { prisma, notifier, pushes } = fakePrisma(rows);
    await activateScheduledRides(prisma, notifier, now, settings);
    expect(rows.map((r) => r.status)).toEqual(["ACCEPTED", "SEARCHING", "SCHEDULED"]);
    expect(pushes).toEqual(["driver:kofi", "customer:c"]);
  });

  it("conducteur plus disponible à l'heure : la course part en recherche, il est prévenu", async () => {
    const rows: Row[] = [{ id: "retenue", status: "SCHEDULED", driverId: "kofi", scheduledFor: at(10 * 60_000) }];
    const { prisma, notifier, pushes } = fakePrisma(rows, []);
    await activateScheduledRides(prisma, notifier, now, settings);
    expect(rows[0]).toMatchObject({ status: "SEARCHING", driverId: null });
    expect(pushes).toEqual(["driver:kofi"]);
  });
});

describe("course demandée", () => {
  const s = { zedMinFee: 300, zedPerKmFee: 150, zedRadiusM: 1000, zedFarRadiusM: 5000 };
  it("prix au km arrondi aux 50 FCFA supérieurs, jamais sous le minimum", () => {
    expect(zedPrice(4200, s)).toBe(650); // 4,2 km × 150 = 630 → 650
    expect(zedPrice(800, s)).toBe(300); // 120 FCFA → minimum
    expect(zedPrice(10_000, s)).toBe(1500);
  });
  it("grille par tranches de l'itinéraire (mode GRID)", () => {
    const g = { ...s, zedPricingMode: "GRID" };
    expect(zedPrice(4200, g)).toBe(500);
    expect(zedPrice(8000, g)).toBe(1000);
    expect(zedPrice(15_000, g)).toBe(1500);
  });
  it("rayon élargi seulement pour une course demandée", () => {
    expect(searchRadiusM("CALL", s)).toBe(1000);
    expect(searchRadiusM("REQUEST", s)).toBe(5000);
    expect(searchRadiusM("REQUEST", { zedRadiusM: 2000, zedFarRadiusM: 1500 })).toBe(2000);
  });
});

describe("une seule alerte par course", () => {
  it("deux alertes créées ensemble : la première est gardée, l'autre annulée", async () => {
    const t0 = new Date("2026-11-16T08:00:00Z");
    const offers = [
      { id: "b", sentAt: t0, status: "SENT" },
      { id: "a", sentAt: t0, status: "SENT" },
    ];
    const prisma = {
      zedOffer: {
        findMany: async () => offers.filter((o) => o.status === "SENT"),
        updateMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          for (const o of offers) if (where.id.in.includes(o.id)) o.status = "CANCELLED";
          return { count: where.id.in.length };
        },
      },
    } as unknown as PrismaClient;
    expect(await keepFirstOffer(prisma, "r", "b", t0)).toBe(false);
    expect(offers.map((o) => o.status)).toEqual(["CANCELLED", "SENT"]);
    expect(await keepFirstOffer(prisma, "r", "a", t0)).toBe(true);
  });
});
