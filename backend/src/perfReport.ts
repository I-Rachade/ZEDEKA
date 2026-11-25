import type { PrismaClient } from "@prisma/client";
import { BUCKET_SECONDS, HIST_COLUMNS, LATENCY_BOUNDS, bucketOf, percentileFromHist } from "./apiMetrics.js";
import type { Notifier } from "./notify.js";

// Lecture des mesures de l'API (table ApiMetric) pour la page « Performance » de l'admin, et alertes simples
// envoyées à l'équipe technique (catégorie TECH du fil des notifications) quand ça se dégrade.

type Sums = { count: number; errors: number; clientErrors: number; totalMs: number; hist: number[]; maxMs: number };

const SUM_FIELDS = { count: true, errors: true, clientErrors: true, totalMs: true, ...Object.fromEntries(HIST_COLUMNS.map((c) => [c, true])) } as const;

type Grouped = { _sum: Record<string, number | null>; _max?: Record<string, number | null> };

function sumsOf(g: Grouped | null | undefined): Sums {
  const s = g?._sum ?? {};
  return {
    count: s.count ?? 0,
    errors: s.errors ?? 0,
    clientErrors: s.clientErrors ?? 0,
    totalMs: s.totalMs ?? 0,
    hist: HIST_COLUMNS.map((c) => s[c] ?? 0),
    maxMs: g?._max?.maxMs ?? 0,
  };
}

const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);

function summary(s: Sums) {
  return {
    requests: s.count,
    errors: s.errors,
    clientErrors: s.clientErrors,
    errorRate: pct(s.errors, s.count),
    avgMs: s.count ? Math.round(s.totalMs / s.count) : null,
    p50: percentileFromHist(s.hist, 0.5),
    p95: percentileFromHist(s.hist, 0.95),
    maxMs: s.maxMs,
    // Part des réponses en moins de 500 ms.
    fastRate: pct(s.hist.slice(0, LATENCY_BOUNDS.indexOf(500) + 1).reduce((a, b) => a + b, 0), s.count),
  };
}

// Disponibilité : minutes où le cron a battu avec une base qui répond, sur les minutes écoulées depuis le premier
// battement connu (les mesures n'existent pas avant la mise en ligne de ce suivi).
async function availability(prisma: PrismaClient, fromSec: number, toSec: number) {
  const where = { route: "cron", bucket: { gte: bucketOf(fromSec * 1000), lt: toSec } };
  const [beats, first] = await Promise.all([
    prisma.apiMetric.aggregate({ where, _sum: { count: true, errors: true, totalMs: true } }),
    prisma.apiMetric.findFirst({ where: { route: "cron" }, orderBy: { bucket: "asc" }, select: { bucket: true } }),
  ]);
  const ok = (beats._sum.count ?? 0) - (beats._sum.errors ?? 0);
  if (!first) return { rate: null, okMinutes: 0, expectedMinutes: 0, dbAvgMs: null };
  const start = Math.max(fromSec, first.bucket);
  const expected = Math.max(1, Math.floor((toSec - start) / 60));
  return {
    rate: Math.min(100, Math.round((ok / expected) * 1000) / 10),
    okMinutes: ok,
    expectedMinutes: expected,
    dbAvgMs: beats._sum.count ? Math.round((beats._sum.totalMs ?? 0) / beats._sum.count) : null,
  };
}

export const PERF_HOURS = [1, 24, 168] as const;

export async function perfReport(prisma: PrismaClient, hours: number, now = new Date()) {
  const toSec = Math.floor(now.getTime() / 1000);
  const span = hours * 3600;
  const fromSec = toSec - span;
  const current = { route: { not: "cron" }, bucket: { gte: bucketOf(fromSec * 1000), lt: toSec + BUCKET_SECONDS } };
  const previous = { route: { not: "cron" }, bucket: { gte: bucketOf((fromSec - span) * 1000), lt: bucketOf(fromSec * 1000) } };
  // Pas du graphique : 5 min sur une heure, 1 h sur un jour, 6 h sur une semaine.
  const step = hours <= 1 ? BUCKET_SECONDS : hours <= 24 ? 3600 : 6 * 3600;

  const [cur, prev, byRoute, byBucket, uptime, uptimePrev] = await Promise.all([
    prisma.apiMetric.aggregate({ where: current, _sum: SUM_FIELDS, _max: { maxMs: true } }),
    prisma.apiMetric.aggregate({ where: previous, _sum: SUM_FIELDS, _max: { maxMs: true } }),
    prisma.apiMetric.groupBy({ by: ["route"], where: current, _sum: SUM_FIELDS, _max: { maxMs: true } }),
    prisma.apiMetric.groupBy({ by: ["bucket"], where: current, _sum: SUM_FIELDS }),
    availability(prisma, fromSec, toSec),
    availability(prisma, fromSec - span, fromSec),
  ]);

  const routes = (byRoute as unknown as (Grouped & { route: string })[]).map((g) => ({ route: g.route, ...summary(sumsOf(g)) }));

  const series = new Map<number, Sums>();
  for (let t = Math.floor(fromSec / step) * step; t <= toSec; t += step) series.set(t, sumsOf(null));
  for (const g of byBucket as unknown as (Grouped & { bucket: number })[]) {
    const key = Math.floor(g.bucket / step) * step;
    const into = series.get(key);
    if (!into) continue;
    const s = sumsOf(g);
    into.count += s.count;
    into.errors += s.errors;
    into.clientErrors += s.clientErrors;
    into.totalMs += s.totalMs;
    s.hist.forEach((v, i) => (into.hist[i] += v));
  }

  return {
    hours,
    from: new Date(fromSec * 1000).toISOString(),
    to: now.toISOString(),
    current: { ...summary(sumsOf(cur as Grouped)), availability: uptime },
    previous: { ...summary(sumsOf(prev as Grouped)), availability: uptimePrev },
    series: [...series.entries()].map(([t, s]) => ({ at: new Date(t * 1000).toISOString(), requests: s.count, errors: s.errors, p95: percentileFromHist(s.hist, 0.95) })),
    busiest: [...routes].sort((a, b) => b.requests - a.requests).slice(0, 10),
    slowest: routes.filter((r) => r.requests >= 5).sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0)).slice(0, 10),
    failing: routes.filter((r) => r.errors > 0).sort((a, b) => b.errors - a.errors).slice(0, 10),
  };
}

// Seuils des alertes, sur les 15 dernières minutes.
export const ALERT_WINDOW_MIN = 15;
export const ALERTS = {
  errorRate: 5, // % de réponses 5xx…
  minErrors: 5, // …avec au moins tant d'erreurs (une erreur isolée ne réveille personne)
  slowP95Ms: 3000, // 95 % des réponses en moins de 3 s…
  minRequests: 30, // …mesuré sur assez de requêtes
  slowDbMs: 1500, // temps moyen de la base vu par le cron
  silenceMinutes: 60, // une même alerte au plus une fois par heure
};

// Vérifie les mesures récentes et prévient l'équipe (fil des notifications, catégorie TECH) ; renvoie les alertes envoyées.
export async function checkPerfAlerts(prisma: PrismaClient, notifier: Notifier, now = new Date()): Promise<string[]> {
  const since = bucketOf(now.getTime() - ALERT_WINDOW_MIN * 60_000);
  const [api, db] = await Promise.all([
    prisma.apiMetric.aggregate({ where: { route: { not: "cron" }, bucket: { gte: since } }, _sum: SUM_FIELDS, _max: { maxMs: true } }),
    prisma.apiMetric.aggregate({ where: { route: "cron", bucket: { gte: since } }, _sum: { count: true, errors: true, totalMs: true } }),
  ]);
  const s = sumsOf(api as Grouped);
  const found: { title: string; body: string }[] = [];
  const rate = s.count ? (s.errors / s.count) * 100 : 0;
  if (s.errors >= ALERTS.minErrors && rate >= ALERTS.errorRate)
    found.push({ title: "Erreurs du serveur élevées", body: `${s.errors} erreurs sur ${s.count} requêtes (${Math.round(rate)} %) ces ${ALERT_WINDOW_MIN} dernières minutes.` });
  const p95 = percentileFromHist(s.hist, 0.95);
  if (s.count >= ALERTS.minRequests && p95 !== null && p95 > ALERTS.slowP95Ms)
    found.push({ title: "API lente", body: `95 % des réponses en ${(p95 / 1000).toFixed(1)} s ou moins ces ${ALERT_WINDOW_MIN} dernières minutes (objectif : 3 s).` });
  const beats = db._sum.count ?? 0;
  const dbMs = beats ? (db._sum.totalMs ?? 0) / beats : 0;
  if (beats && dbMs > ALERTS.slowDbMs) found.push({ title: "Base de données lente", body: `La base répond en ${Math.round(dbMs)} ms en moyenne ces ${ALERT_WINDOW_MIN} dernières minutes.` });
  if ((db._sum.errors ?? 0) > 0) found.push({ title: "Base de données en erreur", body: `${db._sum.errors} vérification(s) de la base en échec ces ${ALERT_WINDOW_MIN} dernières minutes.` });

  const sent: string[] = [];
  for (const a of found) {
    const recent = await prisma.staffNotification.findFirst({
      where: { category: "TECH", title: a.title, createdAt: { gte: new Date(now.getTime() - ALERTS.silenceMinutes * 60_000) } },
      select: { id: true },
    });
    if (recent) continue;
    await notifier.staff("TECH", { title: a.title, body: a.body, url: "/admin/performance", tag: `tech-${a.title}` });
    sent.push(a.title);
  }
  return sent;
}
