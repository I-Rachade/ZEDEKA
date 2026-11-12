import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { issueToken } from "./auth.js";
import { clearRouteCache, fetchRoute, parsePoint } from "./routing.js";

// Réponse OSRM réduite : deux étapes (départ, virage à gauche) puis l'arrivée.
const osrm = {
  code: "Ok",
  routes: [
    {
      distance: 1234.4,
      duration: 180.6,
      geometry: { coordinates: [[1.2123, 6.1319], [1.2201, 6.1355], [1.23, 6.15]] },
      legs: [
        {
          steps: [
            { distance: 600.2, name: "Boulevard du 13 Janvier", maneuver: { type: "depart", location: [1.2123, 6.1319] } },
            { distance: 634.2, name: "", maneuver: { type: "turn", modifier: "left", location: [1.2201, 6.1355] } },
            { distance: 0, name: "", maneuver: { type: "arrive", location: [1.23, 6.15] } },
          ],
        },
      ],
    },
  ],
};

function fakeFetch(body: unknown, status = 200) {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetcher };
}

describe("itinéraire", () => {
  beforeEach(() => clearRouteCache());

  it("lit un point « latitude,longitude »", () => {
    expect(parsePoint("6.1319,1.2123")).toEqual({ latitude: 6.1319, longitude: 1.2123 });
    expect(parsePoint("6.1319, 1.2123")).toBeNull();
    expect(parsePoint("0,0")).toBeNull();
    expect(parsePoint("91,1")).toBeNull();
    expect(parsePoint(undefined)).toBeNull();
  });

  it("interroge le service OSRM et remet le tracé dans l'ordre latitude, longitude", async () => {
    const { calls, fetcher } = fakeFetch(osrm);
    const route = await fetchRoute({ latitude: 6.1319, longitude: 1.2123 }, { latitude: 6.15, longitude: 1.23 }, { baseUrl: "https://osrm.test/", fetcher });
    expect(calls[0]).toBe("https://osrm.test/route/v1/driving/1.2123,6.1319;1.23,6.15?overview=full&geometries=geojson&steps=true&alternatives=false");
    expect(route).toMatchObject({ distanceM: 1234, durationS: 181 });
    expect(route!.line[0]).toEqual([6.1319, 1.2123]);
    expect(route!.steps[1]).toEqual({ type: "turn", modifier: "left", name: "", exit: null, latitude: 6.1355, longitude: 1.2201, distanceM: 634 });
    // Même trajet redemandé : servi par le cache.
    await fetchRoute({ latitude: 6.1319, longitude: 1.2123 }, { latitude: 6.15, longitude: 1.23 }, { baseUrl: "https://osrm.test/", fetcher });
    expect(calls).toHaveLength(1);
  });

  it("aucun itinéraire : null", async () => {
    const { fetcher } = fakeFetch({ code: "NoRoute", routes: [] });
    expect(await fetchRoute({ latitude: 6.1, longitude: 1.2 }, { latitude: 6.2, longitude: 1.3 }, { fetcher })).toBeNull();
  });

  describe("GET /api/livreur/route", () => {
    const secret = "s".repeat(64);
    const prisma = {
      driver: {
        findUnique: async () => ({ status: "APPROVED", active: true, sessionsValidFrom: null }),
        update: async () => ({}),
      },
    } as unknown as PrismaClient;
    const token = issueToken(secret, Date.now(), "driver", "drv1");

    it("réservé aux livreurs connectés", async () => {
      const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: secret, routeFetcher: fakeFetch(osrm).fetcher });
      await request(app).get("/api/livreur/route?from=6.1319,1.2123&to=6.15,1.23").expect(401);
    });

    it("renvoie le tracé et les manœuvres", async () => {
      const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: secret, routeFetcher: fakeFetch(osrm).fetcher });
      const res = await request(app).get("/api/livreur/route?from=6.1319,1.2123&to=6.15,1.23").set({ authorization: `Bearer ${token}` }).expect(200);
      expect(res.body.distanceM).toBe(1234);
      expect(res.body.steps.map((s: { type: string }) => s.type)).toEqual(["depart", "turn", "arrive"]);
    });

    it("refuse un point invalide ou trop lointain, et signale un service en panne", async () => {
      const app = createApp(prisma, { frontendOrigin: "", zedekaWhatsapp: "", adminSecret: secret, routeFetcher: fakeFetch({}, 502).fetcher });
      const auth = { authorization: `Bearer ${token}` };
      await request(app).get("/api/livreur/route?from=abc&to=6.15,1.23").set(auth).expect(400);
      await request(app).get("/api/livreur/route?from=6.13,1.21&to=48.85,2.35").set(auth).expect(400);
      await request(app).get("/api/livreur/route?from=6.13,1.21&to=6.15,1.23").set(auth).expect(503);
    });
  });
});
