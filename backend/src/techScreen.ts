import type { PrismaClient } from "@prisma/client";
import { bucketOf } from "./apiMetrics.js";
import { perfReport } from "./perfReport.js";
import { techLive } from "./routes/adminTech.js";
import { vitalsSummary } from "./routes/vitals.js";
import type { OnlineCounter } from "./techSamples.js";
import { auditView } from "./securityAudit.js";
import { detectAnomalies, improvements } from "./techInsights.js";

// Écran technique (/ecran-technique) : tout ce que l'écran affiche, en une lecture. Vitalité (note sur 100), utilisateurs
// en ligne, signes vitaux de l'API, erreurs récentes. Le bilan quotidien, les anomalies et « quoi améliorer » s'y
// ajoutent (src/securityAudit.ts, src/techInsights.ts).

export type Level = "good" | "warn" | "bad" | "none";

export type VitalInput = {
  availability24h: number | null; // %
  errorRate1h: number | null; // % de réponses 5xx
  p95Ms1h: number | null;
  dbMs: number | null;
  lastBeatAgoSec: number | null;
  realtime: boolean;
  // Failles du dernier bilan (null : pas encore de bilan).
  audit: { critical: number; high: number } | null;
};

// Part d'une mesure entre « parfait » (1) et « à zéro » (0), en ligne droite entre les deux seuils.
const between = (v: number | null, best: number, worst: number) => {
  if (v === null) return 1;
  if (best < worst) return v <= best ? 1 : v >= worst ? 0 : (worst - v) / (worst - best);
  return v >= best ? 1 : v <= worst ? 0 : (v - worst) / (best - worst);
};

export const VITALITY_PARTS = [
  { key: "availability", label: "Disponibilité", max: 25 },
  { key: "errors", label: "Erreurs du serveur", max: 20 },
  { key: "speed", label: "Temps de réponse", max: 15 },
  { key: "database", label: "Base de données", max: 10 },
  { key: "cron", label: "Tâches automatiques", max: 10 },
  { key: "realtime", label: "Temps réel", max: 5 },
  { key: "security", label: "Sécurité", max: 15 },
] as const;

// Note de vitalité sur 100 : chaque part compte selon son poids ; vert à 90 et plus, orange de 70 à 89, rouge sinon.
export function vitality(i: VitalInput) {
  const share: Record<(typeof VITALITY_PARTS)[number]["key"], number> = {
    availability: between(i.availability24h, 99.9, 95),
    errors: between(i.errorRate1h, 0.5, 5),
    speed: between(i.p95Ms1h, 1000, 3000),
    database: between(i.dbMs, 200, 1500),
    cron: i.lastBeatAgoSec === null ? 0 : i.lastBeatAgoSec <= 600 ? 1 : 0,
    realtime: i.realtime ? 1 : 0,
    security: !i.audit ? 1 : i.audit.critical > 0 ? 0 : i.audit.high > 0 ? 0.4 : 1,
  };
  const parts = VITALITY_PARTS.map((p) => ({ ...p, points: Math.round(share[p.key] * p.max * 10) / 10 }));
  const score = Math.round(parts.reduce((a, p) => a + p.points, 0));
  const level: Level = score >= 90 ? "good" : score >= 70 ? "warn" : "bad";
  return { score, level, parts };
}

const levelOf = (v: number | null, good: number, bad: number): Level => {
  if (v === null) return "none";
  if (good < bad) return v <= good ? "good" : v < bad ? "warn" : "bad";
  return v >= good ? "good" : v > bad ? "warn" : "bad";
};

export async function techScreen(prisma: PrismaClient, online: OnlineCounter | undefined, now = new Date()) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const [hour, day, live, lastBeat, pages, lastAudit, probes, anomalies] = await Promise.all([
    perfReport(prisma, 1, now),
    perfReport(prisma, 24, now),
    techLive(prisma, online, now),
    prisma.apiMetric.findFirst({ where: { route: "cron" }, orderBy: { bucket: "desc" }, select: { bucket: true } }),
    vitalsSummary(prisma, now).catch(() => []),
    prisma.securityAudit.findFirst({ orderBy: { day: "desc" } }).catch(() => null),
    // Dernier test de santé de l'API (toutes les 5 min) : routes essentielles qui répondent, sur le total.
    prisma.techSample
      .findMany({ where: { metric: { in: ["probe:ok", "probe:total", "probe:avgMs"] }, bucket: { gte: Math.floor(now.getTime() / 1000) - 1800 } }, orderBy: { bucket: "desc" }, take: 3 })
      .catch(() => []),
    detectAnomalies(prisma, now).catch(() => []),
  ]);
  // Bilan de moins de 36 h : il compte dans la note ; plus ancien, il est montré mais ne compte plus.
  const audit = lastAudit ? auditView(lastAudit) : null;
  const auditFresh = audit && now.getTime() - Date.parse(audit.ranAt) < 36 * 3_600_000;
  // Battement le plus récent : fin de sa tranche de 5 min, au plus maintenant.
  const lastBeatAgoSec = lastBeat ? Math.max(0, nowSec - Math.min(nowSec, lastBeat.bucket + 300)) : null;
  // Vitesse sur téléphone : page la plus visitée, 75e centile du temps d'affichage (LCP).
  const topPage = pages[0] as { page: string; LCP?: number | null } | undefined;
  const phoneLcp = topPage?.LCP ?? null;

  const probeAt = probes[0]?.bucket;
  const probeOf = (m: string) => probes.find((p) => p.bucket === probeAt && p.metric === m)?.value ?? null;
  const probe = probeAt === undefined ? null : { at: new Date(probeAt * 1000).toISOString(), ok: probeOf("probe:ok"), total: probeOf("probe:total"), avgMs: probeOf("probe:avgMs") };

  const input: VitalInput = {
    availability24h: day.current.availability.rate,
    errorRate1h: hour.current.errorRate,
    p95Ms1h: hour.current.p95,
    dbMs: hour.current.availability.dbAvgMs,
    lastBeatAgoSec,
    realtime: live.online !== null,
    audit: auditFresh ? { critical: audit.counts.critical, high: audit.counts.high } : null,
  };

  return {
    checkedAt: now.toISOString(),
    vitality: vitality(input),
    live,
    vitals: [
      { key: "availability", label: "Disponibilité 24 h", value: input.availability24h, unit: "%", level: levelOf(input.availability24h, 99.9, 99) },
      { key: "errors", label: "Erreurs serveur (1 h)", value: input.errorRate1h, unit: "%", level: levelOf(input.errorRate1h, 1, 5) },
      { key: "p50", label: "Réponse médiane", value: hour.current.p50, unit: "ms", level: levelOf(hour.current.p50, 300, 1000) },
      { key: "p95", label: "Réponse 95 %", value: input.p95Ms1h, unit: "ms", level: levelOf(input.p95Ms1h, 1000, 3000) },
      { key: "db", label: "Base de données", value: input.dbMs, unit: "ms", level: levelOf(input.dbMs, 200, 1500) },
      { key: "cron", label: "Tâches automatiques", value: lastBeatAgoSec, unit: "s", level: lastBeatAgoSec === null ? "bad" : levelOf(lastBeatAgoSec, 360, 600) },
      { key: "realtime", label: "Temps réel", value: live.online?.total ?? null, unit: "connexions", level: (live.online ? "good" : "bad") as Level },
      {
        key: "probe",
        label: "Tests de santé de l'API",
        value: probe?.ok ?? null,
        total: probe?.total ?? null,
        unit: "routes",
        level: (!probe || probe.ok === null || probe.total === null ? "none" : probe.ok === probe.total ? "good" : probe.ok === 0 ? "bad" : "warn") as Level,
      },
      { key: "phone", label: "Pages sur téléphone", value: phoneLcp, unit: "ms", level: levelOf(phoneLcp, 2500, 4000), page: topPage?.page ?? null },
    ],
    api: {
      probe,
      requests1h: hour.current.requests,
      slowest: day.slowest.slice(0, 3).map((r) => ({ route: r.route, p95: r.p95, requests: r.requests })),
      failing: day.failing.slice(0, 3).map((r) => ({ route: r.route, errors: r.errors, errorRate: r.errorRate })),
    },
    anomalies,
    improvements: await improvements(
      prisma,
      { slowest: day.slowest, failing: day.failing, phonePages: pages as { page: string; LCP?: number | null }[], audit: audit && auditFresh ? audit : null },
      now,
    ).catch(() => []),
    audit: audit ? { ranAt: audit.ranAt, durationSec: audit.durationSec, counts: audit.counts, checks: audit.checks, fresh: Boolean(auditFresh) } : null,
    series: hour.series.map((s) => ({ at: s.at, requests: s.requests, errors: s.errors })),
    bucket: bucketOf(now.getTime()),
  };
}
