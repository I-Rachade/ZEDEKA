import { describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "./auth.js";
import { buildReport, subscriptionsPerDay } from "./stats.js";

const from = new Date("2026-10-20T00:00:00Z");
const order = (day: number, extra: Partial<Parameters<typeof buildReport>[0][number]> = {}) => ({
  restaurantName: "Chez Tante Ama",
  status: "DELIVERED",
  deliveryFee: 1000,
  extraFee: 0,
  discount: 0,
  commission: 500,
  driverEarning: 0,
  createdAt: new Date(Date.UTC(2026, 9, 20 + day, 12)),
  deliveredAt: new Date(Date.UTC(2026, 9, 20 + day, 12, 30)),
  ...extra,
});

describe("buildReport", () => {
  it("calcule revenu par jour, seuil et délai moyen", () => {
    const orders = [
      ...Array.from({ length: 9 }, () => order(0)),
      order(1, { restaurantName: "Le Maquis du Port", deliveredAt: null }),
      order(1, { status: "CANCELLED" }),
    ];
    const r = buildReport(orders, from, 2);
    expect(r.perDay[0]).toMatchObject({ date: "2026-10-20", orders: 9, revenue: 13500, aboveBreakEven: true });
    expect(r.perDay[1]).toMatchObject({ orders: 1, revenue: 1500, aboveBreakEven: false });
    expect(r.cancelled).toBe(1);
    expect(r.avgDeliveryMinutes).toBe(30);
    expect(r.perRestaurant[0]).toEqual({ name: "Chez Tante Ama", orders: 9, perDay: 4.5 });
  });
});

describe("jetons admin", () => {
  it("accepte un jeton valide et refuse un jeton expiré ou falsifié", () => {
    const token = issueToken("secret", 1_000);
    expect(verifyToken(token, "secret", 2_000)).toBe(true);
    expect(verifyToken(token, "autre", 2_000)).toBe(false);
    expect(verifyToken(token, "secret", 1_000 + 13 * 3_600_000)).toBe(false);
    expect(verifyToken("123.abc", "secret", 0)).toBe(false);
  });
});

describe("abonnements", () => {
  it("ajoute la part journalière des abonnements au revenu et au seuil", () => {
    expect(subscriptionsPerDay([{ subscriptionFee: 15000 }, { subscriptionFee: 15000 }, { subscriptionFee: null }])).toBe(1000);
    const from = new Date("2026-10-01T00:00:00Z");
    const r = buildReport([], from, 2, 14000);
    expect(r.perDay.map((d) => [d.revenue, d.aboveBreakEven])).toEqual([[14000, true], [14000, true]]);
    expect([r.revenue, r.subscriptionsPerDay]).toEqual([28000, 14000]);
  });
});
