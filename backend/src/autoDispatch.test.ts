import { describe, expect, it } from "vitest";
import { pickDriver, type Candidate } from "./autoDispatch.js";

const now = new Date("2026-11-01T12:00:00Z");
const recent = new Date(now.getTime() - 60_000);
const old = new Date(now.getTime() - 60 * 60_000);
const lome = { latitude: 6.1319, longitude: 1.2228 };
const d = (id: string, zoneId: string | null, lat: number | null, lng: number | null, at: Date | null): Candidate => ({
  id,
  zoneId,
  lastLatitude: lat,
  lastLongitude: lng,
  lastLocationAt: at,
});

describe("attribution automatique : choix du livreur", () => {
  it("prend le plus proche du point de retrait", () => {
    const far = d("far", "z1", 6.17, 1.25, recent);
    const near = d("near", "z2", 6.133, 1.223, recent);
    expect(pickDriver([far, near], lome, "z1", now)?.id).toBe("near");
  });

  it("ignore une position trop ancienne et retombe sur la zone", () => {
    const stale = d("stale", "z2", 6.132, 1.223, old);
    const sameZone = d("zone", "z1", null, null, null);
    expect(pickDriver([stale, sameZone], lome, "z1", now)?.id).toBe("zone");
  });

  it("préfère un livreur avec position récente à un livreur sans position", () => {
    const located = d("loc", "z2", 6.2, 1.25, recent);
    const blind = d("blind", "z1", null, null, null);
    expect(pickDriver([blind, located], lome, "z1", now)?.id).toBe("loc");
  });

  it("ne propose personne au-delà de 15 km ni hors zone sans position", () => {
    const tooFar = d("far", "z1", 6.5, 1.6, recent);
    const otherZone = d("other", "z2", null, null, null);
    expect(pickDriver([tooFar, otherZone], lome, "z1", now)).toBeNull();
  });
});
