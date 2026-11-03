import { describe, expect, it } from "vitest";
import { activePlan, nextPeriod, offerExpiresAt, rankZedDrivers, ZED_FRESH_POSITION_MS } from "./zed.js";

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
