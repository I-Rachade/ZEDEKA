import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { computeKpis, dailySeries, kpiReport, quantile, type KpiOrder, type KpiRide, type KpiService } from "./kpi.js";

const T = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 22, h, m));

function order(o: Partial<KpiOrder>): KpiOrder {
  return {
    type: "FOOD",
    status: "DELIVERED",
    storeSale: false,
    fulfillment: "DELIVERY",
    createdAt: T(12),
    confirmedAt: T(12, 2),
    readyAt: T(12, 20),
    pickedUpAt: T(12, 25),
    deliveredAt: T(12, 45),
    cancelledAt: null,
    cancellationReason: null,
    customerId: "c1",
    driverId: "d1",
    restaurantId: "r1",
    subtotal: 5000,
    total: 6000,
    deliveryFee: 1000,
    extraFee: 0,
    discount: 0,
    promoPayer: null,
    commission: 500,
    driverEarning: 700,
    ...o,
  };
}
const ride = (r: Partial<KpiRide>): KpiRide => ({ status: "COMPLETED", createdAt: T(9), acceptedAt: T(9, 3), completedAt: T(9, 20), cancelledAt: null, price: 1500, quotedPrice: 1400, customerId: "c2", driverId: "d2", ...r });
const service = (r: Partial<KpiService>): KpiService => ({ module: "GAS", status: "DONE", createdAt: T(10), acceptedAt: T(10, 10), completedAt: T(11), cancelledAt: null, finalPrice: 8000, estimate: 7000, customerId: "c1", providerId: "d3", ...r });

describe("indicateurs clés (KPI)", () => {
  it("calcule volume, acceptation, délais, annulations, panier et revenus", () => {
    const orders = [
      order({}),
      order({ customerId: "c3", subtotal: 3000, total: 4000 }),
      order({ status: "CANCELLED", confirmedAt: null, readyAt: null, pickedUpAt: null, deliveredAt: null, cancellationReason: "Restaurant fermé" }),
      order({ type: "PARCEL", confirmedAt: null, readyAt: null, createdAt: T(14), pickedUpAt: T(14, 15), deliveredAt: T(14, 40), total: 1500, deliveryFee: 1500, commission: 0, driverEarning: 1000 }),
      order({ storeSale: true, customerId: "c4" }),
    ];
    const k = computeKpis(orders, [ride({}), ride({ status: "CANCELLED", acceptedAt: null, completedAt: null })], [service({})], 1);
    expect(k.byService).toEqual({ food: 3, shop: 1, parcel: 1, ride: 2, service: 1 });
    expect(k.orders).toBe(8);
    expect(k.cancelled).toBe(2);
    expect(k.cancellationRate).toBe(25);
    expect(k.cancellationReasons).toEqual([{ reason: "Restaurant fermé", count: 1 }]);
    // 3 repas acceptés sur 4 commandes tranchées (repas et boutique).
    expect(k.acceptanceRate).toBe(75);
    expect(k.rideAcceptanceRate).toBe(50);
    expect(k.stages).toMatchObject({ accept: 2, prepare: 18, waitDriver: 5, deliverFood: 20, parcelPickup: 15, deliverParcel: 25, rideAccept: 3, serviceAccept: 10 });
    expect(k.deliveryMinutes.median).toBe(45);
    // Panier moyen des repas et boutiques non annulés : (5000 + 3000 + 5000) / 3.
    expect(k.avgBasket).toBe(4333);
    expect(k.revenueByService.ride.gmv).toBe(1500);
    expect(k.revenueByService.service.gmv).toBe(8000);
    expect(k.revenueByService.parcel).toEqual({ gmv: 1500, zedeka: 500 });
    expect(k.revenueByService.food.zedeka).toBe(1600);
    expect(k.activeCustomers).toBe(4);
    expect(k.activeDrivers).toBe(3);
  });

  it("répartit par jour", () => {
    const from = new Date(Date.UTC(2026, 10, 21));
    const rows = dailySeries({ orders: [order({}), order({ createdAt: new Date(Date.UTC(2026, 10, 21, 8)), status: "CANCELLED" })], rides: [ride({})], services: [] }, from, 2);
    expect(rows.map((r) => [r.date, r.food, r.ride, r.cancelled, r.revenue])).toEqual([
      ["2026-11-21", 1, 0, 1, 0],
      ["2026-11-22", 1, 1, 0, 800],
    ]);
  });

  it("quantiles", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
  });

  it("compare à la période précédente et mesure la fidélité", async () => {
    const now = new Date(Date.UTC(2026, 10, 22, 18));
    const windows: { gte: Date; lt: Date }[] = [];
    const prisma = {
      order: {
        findMany: async ({ where }: { where: { createdAt: { gte: Date; lt: Date } } }) => {
          windows.push(where.createdAt);
          const current = where.createdAt.lt.getTime() === now.getTime();
          return current ? [order({ customerId: "c1" }), order({ customerId: "c9" })] : [order({ customerId: "c1" }), order({ customerId: "c2" })];
        },
      },
      zedRide: { findMany: async () => [] },
      serviceRequest: { findMany: async () => [] },
      customer: { count: async () => 3 },
      driver: { count: async ({ where }: { where: { online?: boolean } }) => (where.online ? 2 : 10) },
      restaurant: {
        findMany: async () => [
          { subscriptionFee: 25000, commissionRate: 0, plan: "ESSENTIEL" },
          { subscriptionFee: 35000, commissionRate: 0, plan: "PRO" },
          { subscriptionFee: null, commissionRate: 15, plan: "ESSENTIEL" },
        ],
      },
      merchant: { findMany: async () => [{ storeSubscriptionFee: 5000 }, { storeSubscriptionFee: null }] },
    } as unknown as PrismaClient;
    const r = await kpiReport(prisma, 7, now);
    // Période en cours : depuis minuit il y a 6 jours (6 j 18 h écoulés) ; précédente : même durée juste avant.
    expect(r.from).toBe("2026-11-16T00:00:00.000Z");
    expect(r.previousFrom).toBe("2026-11-09T06:00:00.000Z");
    expect(windows).toHaveLength(2);
    expect(r.current.retentionRate).toBe(50);
    expect(r.current.returningCustomers).toBe(1);
    expect(r.series).toHaveLength(7);
    expect(r.now).toMatchObject({ driversOnline: 2, driversApproved: 10, subscribedRestaurants: 2, proRestaurants: 1, commissionRestaurants: 1, subscribedShops: 1, monthlySubscriptions: 65000 });
    expect(r.current).not.toHaveProperty("customerIds");
  });
});
