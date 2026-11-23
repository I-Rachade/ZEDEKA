import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { bucketOf } from "./apiMetrics.js";
import { ESSENTIAL_ROUTES } from "./securityAudit.js";
import { alertAnomalies, detectAnomalies, improvements, probeApi, sampleActivity } from "./techInsights.js";

const WEEK = 7 * 86_400;
const now = new Date(Date.UTC(2026, 10, 23, 12, 2));
const nowBucket = bucketOf(now.getTime());

// TechSample en mémoire : writeSamples passe par $executeRawUnsafe, la lecture par findMany.
function samplesDb(rows: { bucket: number; metric: string; value: number }[] = []) {
  const written: { bucket: number; metric: string; value: number }[] = [];
  const prisma = {
    $executeRawUnsafe: async (_sql: string, ...args: (string | number)[]) => {
      for (let i = 0; i < args.length; i += 3) written.push({ bucket: args[i] as number, metric: args[i + 1] as string, value: args[i + 2] as number });
      return 1;
    },
    techSample: {
      findMany: async ({ where }: { where: { metric: { in: string[] }; OR: { bucket: { gte: number; lte: number } }[] } }) =>
        rows.filter((r) => where.metric.in.includes(r.metric) && where.OR.some((w) => r.bucket >= w.bucket.gte && r.bucket <= w.bucket.lte)),
    },
    order: { count: async () => 4, groupBy: async () => [] },
    apiMetric: { aggregate: async () => ({ _sum: { count: 120, errors: 2, h50: 100, h100: 10, h200: 5, h500: 3, h1000: 2, h2000: 0, h5000: 0, hMore: 0 } }) },
    errorEvent: { groupBy: async () => [] },
  } as unknown as PrismaClient;
  return { prisma, written };
}

// Même tranche les 4 semaines précédentes (et ±5 min) : valeur habituelle.
const history = (metric: string, usual: number, current: number) => [
  { bucket: nowBucket, metric, value: current },
  ...[1, 2, 3, 4].flatMap((w) => [-300, 0, 300].map((d) => ({ bucket: nowBucket - w * WEEK + d, metric, value: usual }))),
];

describe("santé de l'API toutes les 5 minutes", () => {
  it("compte les routes qui répondent et note celles en panne dans le journal des erreurs", async () => {
    const { prisma, written } = samplesDb();
    const recorded: { route: string; status: number; message: string }[] = [];
    const result = await probeApi(
      prisma,
      {
        origin: "https://zedeka.test/",
        fetcher: async (url) => (url.endsWith(ESSENTIAL_ROUTES[1]) ? new Response("{}", { status: 503 }) : new Response("[]")),
        errorLog: { record: (e) => void recorded.push(e) },
      },
      now.getTime(),
    );
    expect(result).toMatchObject({ ok: ESSENTIAL_ROUTES.length - 1, total: ESSENTIAL_ROUTES.length });
    expect(recorded).toEqual([expect.objectContaining({ route: ESSENTIAL_ROUTES[1], status: 503, message: "Test de santé : réponse 503" })]);
    expect(written.find((w) => w.metric === "probe:ok")?.value).toBe(ESSENTIAL_ROUTES.length - 1);
  });

  it("site injoignable : aucune route en état", async () => {
    const { prisma } = samplesDb();
    const result = await probeApi(prisma, { origin: "https://zedeka.test", fetcher: async () => Promise.reject(new TypeError("fetch failed")) }, now.getTime());
    expect(result.ok).toBe(0);
    expect(result.avgMs).toBeNull();
  });

  it("relève commandes, requêtes, erreurs et temps de réponse de la tranche écoulée", async () => {
    const { prisma, written } = samplesDb();
    const values = await sampleActivity(prisma, now.getTime());
    expect(values).toMatchObject({ "orders:5m": 4, "requests:5m": 120, "errors:5m": 2 });
    expect(values["p95:5m"]).toBeGreaterThan(0);
    expect(written[0].bucket).toBe(nowBucket - 300);
  });
});

describe("anomalies", () => {
  it("commandes en forte baisse par rapport aux 4 mêmes jours", async () => {
    const { prisma } = samplesDb(history("orders:5m", 10, 1));
    const found = await detectAnomalies(prisma, now);
    expect(found).toEqual([expect.objectContaining({ title: "Commandes en forte baisse", level: "bad" })]);
  });

  it("rien d'anormal quand la valeur est habituelle, ni sans historique", async () => {
    expect(await detectAnomalies(samplesDb(history("orders:5m", 10, 9)).prisma, now)).toEqual([]);
    expect(await detectAnomalies(samplesDb([{ bucket: nowBucket, metric: "orders:5m", value: 0 }]).prisma, now)).toEqual([]);
  });

  it("erreurs en rafale, même sans historique, et routes en panne au test de santé", async () => {
    const rows = [
      { bucket: nowBucket, metric: "errors:5m", value: 12 },
      { bucket: nowBucket, metric: "probe:ok", value: 4 },
      { bucket: nowBucket, metric: "probe:total", value: 6 },
    ];
    const titles = (await detectAnomalies(samplesDb(rows).prisma, now)).map((a) => a.title).sort();
    expect(titles).toEqual(["Erreurs du serveur inhabituelles", "Routes de l'API en panne"]);
  });

  it("une route revenue au test suivant n'est plus signalée", async () => {
    const rows = [
      { bucket: nowBucket - 300, metric: "probe:ok", value: 4 },
      { bucket: nowBucket - 300, metric: "probe:total", value: 6 },
      { bucket: nowBucket, metric: "probe:ok", value: 6 },
      { bucket: nowBucket, metric: "probe:total", value: 6 },
    ];
    expect(await detectAnomalies(samplesDb(rows).prisma, now)).toEqual([]);
  });

  it("alerte le directeur et l'adjoint pour une anomalie grave, une fois par heure", async () => {
    const sent: string[] = [];
    let recent: { id: string } | null = null;
    const prisma = { staffNotification: { findFirst: async () => recent } } as unknown as PrismaClient;
    const notifier = { publicKey: "", push: async () => 0, sms: async () => {}, staff: async (_c: string, p: { title: string }) => (sent.push(p.title), 1) };
    const list = [
      { at: now.toISOString(), title: "Commandes en forte baisse", detail: "", level: "bad" as const },
      { at: now.toISOString(), title: "Pic de commandes", detail: "", level: "warn" as const },
    ];
    expect(await alertAnomalies(prisma, notifier, list, now)).toEqual(["Commandes en forte baisse"]);
    recent = { id: "n1" };
    expect(await alertAnomalies(prisma, notifier, list, now)).toEqual([]);
    expect(sent).toEqual(["Commandes en forte baisse"]);
  });
});

describe("quoi améliorer", () => {
  it("classe les propositions, les plus graves d'abord", async () => {
    const { prisma } = samplesDb();
    const list = await improvements(
      prisma,
      {
        slowest: [{ route: "GET /api/restaurants", p95: 1800, requests: 900 }],
        failing: [{ route: "POST /api/orders", errors: 12, errorRate: 6 }],
        phonePages: [{ page: "/app", LCP: 3100 }],
        audit: { checks: [{ key: "cors", label: "CORS", status: "fail", note: "ouvert à tous", severity: "high" }], ci: { npmAudit: { critical: 1, high: 0 }, tls: { daysLeft: 10 } } },
      },
      now,
    );
    expect(list.map((x) => x.title)).toEqual([
      "Mettre à jour les dépendances vulnérables",
      "Corriger les erreurs de POST /api/orders",
      "Corriger : CORS",
      "Renouveler le certificat HTTPS",
      "Accélérer GET /api/restaurants",
      "Alléger la page /app",
    ]);
  });

  it("motif d'annulation en hausse", async () => {
    let call = 0;
    const prisma = {
      errorEvent: { groupBy: async () => [] },
      order: { groupBy: async () => (call++ === 0 ? [{ cancellationReason: "Livreur trop long", _count: { _all: 8 } }] : [{ cancellationReason: "Livreur trop long", _count: { _all: 2 } }]) },
    } as unknown as PrismaClient;
    const list = await improvements(prisma, { slowest: [], failing: [], phonePages: [], audit: null }, now);
    expect(list).toEqual([{ title: "Annulations en hausse : Livreur trop long", why: "8 en 7 jours, 2 la semaine d'avant", level: "warn" }]);
  });
});
