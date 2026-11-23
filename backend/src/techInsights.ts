import type { PrismaClient } from "@prisma/client";
import { BUCKET_SECONDS, HIST_COLUMNS, bucketOf, percentileFromHist } from "./apiMetrics.js";
import type { ErrorLog } from "./errorLog.js";
import type { Notifier } from "./notify.js";
import { ESSENTIAL_ROUTES, type Fetcher } from "./securityAudit.js";
import { writeSamples } from "./techSamples.js";

// Écran technique, étape 4 : santé de l'API toutes les 5 minutes, anomalies (comparaison avec la même tranche des
// 4 mêmes jours de semaine précédents) et « quoi améliorer » (règles simples, classées par gravité).

export type Level = "good" | "warn" | "bad" | "none";
export type Anomaly = { at: string; title: string; detail: string; level: Level };
export type Improvement = { title: string; why: string; level: Level };
export type ProbeResult = { at: string; ok: number; total: number; avgMs: number | null; maxMs: number | null; failed: { route: string; status: number; ms: number }[] };

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_SLOW_MS = 3_000;
const WEEK_SEC = 7 * 86_400;
const ALERT_SILENCE_MIN = 60;

// ——— Santé de l'API ———

// Appelle les routes essentielles comme un visiteur (par le site public) ; une route en panne ou trop lente entre dans
// le journal des erreurs (source « api », message « Test de santé ») et apparaît en direct sur l'écran.
export async function probeApi(prisma: PrismaClient, opts: { origin: string; fetcher?: Fetcher; errorLog?: Pick<ErrorLog, "record"> }, at = Date.now()): Promise<ProbeResult> {
  const fetcher = opts.fetcher ?? fetch;
  const base = opts.origin.replace(/\/$/, "");
  const results = await Promise.all(
    ESSENTIAL_ROUTES.map(async (route) => {
      const t0 = Date.now();
      try {
        const res = await fetcher(`${base}${route}`, { redirect: "manual", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { "Cache-Control": "no-cache" } });
        await res.body?.cancel().catch(() => {});
        return { route, status: res.status, ms: Date.now() - t0 };
      } catch {
        return { route, status: 0, ms: Date.now() - t0 };
      }
    }),
  );
  const good = results.filter((r) => r.status > 0 && r.status < 400 && r.ms <= PROBE_SLOW_MS);
  const failed = results.filter((r) => !good.includes(r));
  const answered = results.filter((r) => r.status > 0);
  const avgMs = answered.length ? Math.round(answered.reduce((a, r) => a + r.ms, 0) / answered.length) : null;
  const maxMs = answered.length ? Math.max(...answered.map((r) => r.ms)) : null;
  for (const f of failed) {
    opts.errorLog?.record({
      source: "api",
      route: f.route,
      status: f.status,
      message: f.status === 0 ? "Test de santé : pas de réponse" : f.status >= 400 ? `Test de santé : réponse ${f.status}` : "Test de santé : réponse trop lente",
    });
  }
  const values: Record<string, number> = { "probe:ok": good.length, "probe:total": results.length };
  if (avgMs !== null) values["probe:avgMs"] = avgMs;
  if (maxMs !== null) values["probe:maxMs"] = maxMs;
  await writeSamples(prisma, values, at);
  return { at: new Date(at).toISOString(), ok: good.length, total: results.length, avgMs, maxMs, failed };
}

// Relevés d'activité de la tranche de 5 minutes qui vient de se terminer : commandes passées, requêtes, erreurs et
// temps de réponse (95 %) de l'API. Ils servent à repérer les anomalies.
export async function sampleActivity(prisma: PrismaClient, at = Date.now()) {
  const bucket = bucketOf(at) - BUCKET_SECONDS;
  const from = new Date(bucket * 1000);
  const to = new Date((bucket + BUCKET_SECONDS) * 1000);
  const [orders, api] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: from, lt: to } } }),
    prisma.apiMetric.aggregate({
      where: { route: { not: "cron" }, bucket },
      _sum: { count: true, errors: true, ...Object.fromEntries(HIST_COLUMNS.map((c) => [c, true])) },
    }),
  ]);
  const sum = (api._sum ?? {}) as Record<string, number | null>;
  const values: Record<string, number> = { "orders:5m": orders, "requests:5m": sum.count ?? 0, "errors:5m": sum.errors ?? 0 };
  const p95 = percentileFromHist(HIST_COLUMNS.map((c) => sum[c] ?? 0), 0.95);
  if (p95 !== null) values["p95:5m"] = p95;
  await writeSamples(prisma, values, bucket * 1000);
  return values;
}

// ——— Anomalies ———

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Rule = { metric: string; check: (now: number, usual: number | null) => { title: string; detail: string; level: Level } | null };

const fmtMs = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);

// Une anomalie : une valeur loin de l'habitude (médiane de la même tranche ±5 min, les 4 mêmes jours précédents).
export const ANOMALY_RULES: Rule[] = [
  {
    metric: "orders:5m",
    check: (v, usual) =>
      usual !== null && usual >= 3 && v <= usual * 0.3
        ? { title: "Commandes en forte baisse", detail: `${v} commande(s) en 5 min, ${Math.round(usual)} d'habitude à cette heure`, level: "bad" }
        : usual !== null && v >= 6 && v >= Math.max(usual, 1) * 3
          ? { title: "Pic de commandes", detail: `${v} commandes en 5 min, ${Math.round(usual)} d'habitude : prévoir des livreurs`, level: "warn" }
          : null,
  },
  {
    metric: "errors:5m",
    check: (v, usual) =>
      v >= 5 && v >= Math.max(usual ?? 0, 1) * 3 ? { title: "Erreurs du serveur inhabituelles", detail: `${v} erreurs en 5 min, ${Math.round(usual ?? 0)} d'habitude`, level: "bad" } : null,
  },
  {
    metric: "p95:5m",
    check: (v, usual) =>
      v > 1500 && v >= Math.max(usual ?? 0, 300) * 2 ? { title: "API plus lente que d'habitude", detail: `95 % des réponses en ${fmtMs(v)}, ${fmtMs(usual ?? 0)} d'habitude`, level: "warn" } : null,
  },
  {
    metric: "online:livreur",
    check: (v, usual) =>
      usual !== null && usual >= 3 && v <= usual * 0.4 ? { title: "Peu de livreurs en ligne", detail: `${v} en ligne, ${Math.round(usual)} d'habitude à cette heure`, level: "warn" } : null,
  },
  {
    metric: "online:total",
    check: (v, usual) =>
      usual !== null && usual >= 10 && v <= usual * 0.3 ? { title: "Utilisateurs en ligne en chute", detail: `${v} en ligne, ${Math.round(usual)} d'habitude à cette heure`, level: "bad" } : null,
  },
];

// Anomalies de la dernière heure, plus les tests de santé en échec. Lecture seule : rien n'est écrit.
export async function detectAnomalies(prisma: PrismaClient, now = new Date()): Promise<Anomaly[]> {
  const nowBucket = bucketOf(now.getTime());
  const since = nowBucket - 3600;
  const metrics = [...ANOMALY_RULES.map((r) => r.metric), "probe:ok", "probe:total"];
  const windows = [0, 1, 2, 3, 4].map((w) => ({ bucket: { gte: since - w * WEEK_SEC - BUCKET_SECONDS, lte: nowBucket - w * WEEK_SEC + BUCKET_SECONDS } }));
  const rows = await prisma.techSample.findMany({ where: { metric: { in: metrics }, OR: windows }, select: { bucket: true, metric: true, value: true } });
  const value = new Map(rows.map((r) => [`${r.metric}@${r.bucket}`, r.value]));

  const found = new Map<string, Anomaly>();
  for (let b = since; b <= nowBucket; b += BUCKET_SECONDS) {
    for (const rule of ANOMALY_RULES) {
      const v = value.get(`${rule.metric}@${b}`);
      if (v === undefined) continue;
      const past: number[] = [];
      for (let w = 1; w <= 4; w++) {
        for (const d of [-BUCKET_SECONDS, 0, BUCKET_SECONDS]) {
          const x = value.get(`${rule.metric}@${b - w * WEEK_SEC + d}`);
          if (x !== undefined) past.push(x);
        }
      }
      // Moins de deux semaines d'historique : pas de comparaison, sauf les règles qui n'en ont pas besoin.
      const usual = past.length >= 4 ? median(past) : null;
      const hit = rule.check(v, usual);
      // Une seule ligne par sorte d'anomalie : la plus récente.
      if (hit) found.set(hit.title, { at: new Date(b * 1000).toISOString(), ...hit });
    }
    const ok = value.get(`probe:ok@${b}`);
    const total = value.get(`probe:total@${b}`);
    if (ok !== undefined && total !== undefined && ok < total) {
      found.set("Routes de l'API en panne", {
        at: new Date(b * 1000).toISOString(),
        title: "Routes de l'API en panne",
        detail: `${total - ok} route(s) essentielle(s) sur ${total} en échec au test de santé`,
        level: ok === 0 ? "bad" : "warn",
      });
    } else if (ok !== undefined && total !== undefined) {
      found.delete("Routes de l'API en panne");
    }
  }
  return [...found.values()].sort((a, b) => b.at.localeCompare(a.at));
}

// Alerte au directeur et à l'adjoint (fil « Technique ») pour une anomalie grave, au plus une fois par heure.
export async function alertAnomalies(prisma: PrismaClient, notifier: Notifier, anomalies: Anomaly[], now = new Date()) {
  const sent: string[] = [];
  for (const a of anomalies.filter((x) => x.level === "bad")) {
    const recent = await prisma.staffNotification.findFirst({
      where: { category: "TECH", title: a.title, createdAt: { gte: new Date(now.getTime() - ALERT_SILENCE_MIN * 60_000) } },
      select: { id: true },
    });
    if (recent) continue;
    await notifier.staff("TECH", { title: a.title, body: a.detail, url: "/admin/performance", tag: `tech-${a.title}` });
    sent.push(a.title);
  }
  return sent;
}

// ——— Quoi améliorer ———

export type ImprovementInput = {
  slowest: { route: string; p95: number | null; requests: number }[];
  failing: { route: string; errors: number; errorRate: number | null }[];
  phonePages: { page: string; LCP?: number | null }[];
  audit: { checks: { key: string; label: string; status: string; note: string; severity?: string }[]; ci?: { npmAudit?: { critical: number; high: number }; tls?: { daysLeft: number | null } } | null } | null;
};

const RANK: Record<Level, number> = { bad: 0, warn: 1, good: 2, none: 3 };

// Propositions classées (graves d'abord), au plus `limit`. Les données viennent de l'écran technique, du journal
// des erreurs et des annulations de commandes.
export async function improvements(prisma: PrismaClient, input: ImprovementInput, now = new Date(), limit = 6): Promise<Improvement[]> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const [topErrors, cancelNow, cancelBefore] = await Promise.all([
    prisma.errorEvent
      .groupBy({ by: ["fingerprint", "source", "route", "message"], where: { lastAt: { gte: nowSec - 86_400 } }, _sum: { count: true }, orderBy: { _sum: { count: "desc" } }, take: 3 })
      .catch(() => []),
    prisma.order
      .groupBy({ by: ["cancellationReason"], where: { cancelledAt: { gte: new Date(now.getTime() - 7 * 86_400_000) }, cancellationReason: { not: null } }, _count: { _all: true } })
      .catch(() => []),
    prisma.order
      .groupBy({
        by: ["cancellationReason"],
        where: { cancelledAt: { gte: new Date(now.getTime() - 14 * 86_400_000), lt: new Date(now.getTime() - 7 * 86_400_000) }, cancellationReason: { not: null } },
        _count: { _all: true },
      })
      .catch(() => []),
  ]);
  const out: Improvement[] = [];

  // Bilan du jour : failles et contrôles en échec.
  const audit = input.audit;
  if (audit) {
    for (const c of audit.checks.filter((c) => c.status === "fail" && (c.severity === "critical" || c.severity === "high"))) {
      out.push({ title: `Corriger : ${c.label}`, why: c.note || "relevé par le bilan du jour", level: c.severity === "critical" ? "bad" : "warn" });
    }
    const deps = audit.ci?.npmAudit;
    if (deps && deps.critical + deps.high > 0 && !audit.checks.some((c) => c.key === "deps" && c.status === "fail")) {
      out.push({ title: "Mettre à jour les dépendances vulnérables", why: `${deps.critical} critique(s), ${deps.high} élevée(s) selon npm audit`, level: deps.critical ? "bad" : "warn" });
    }
    const days = audit.ci?.tls?.daysLeft;
    if (typeof days === "number" && days < 21 && !audit.checks.some((c) => c.key === "tls" && c.status === "fail")) {
      out.push({ title: "Renouveler le certificat HTTPS", why: `il expire dans ${days} jour(s)`, level: days < 7 ? "bad" : "warn" });
    }
  }

  // Routes en erreur et erreurs les plus fréquentes.
  for (const r of input.failing.filter((r) => r.errors >= 3).slice(0, 2)) {
    out.push({ title: `Corriger les erreurs de ${r.route}`, why: `${r.errors} erreurs du serveur sur 24 h${r.errorRate !== null ? ` (${r.errorRate} %)` : ""}`, level: (r.errorRate ?? 0) >= 5 ? "bad" : "warn" });
  }
  for (const e of topErrors) {
    const n = e._sum.count ?? 0;
    if (n < 10 || out.some((x) => x.title.endsWith(e.route))) continue;
    out.push({ title: `Erreur fréquente : ${e.message.slice(0, 60)}`, why: `${n} fois en 24 h (${e.source}, ${e.route})`, level: n >= 50 ? "bad" : "warn" });
  }

  // Lenteurs : API puis pages sur téléphone.
  for (const r of input.slowest.filter((r) => (r.p95 ?? 0) > 1000).slice(0, 2)) {
    out.push({ title: `Accélérer ${r.route}`, why: `95 % des réponses en ${fmtMs(r.p95 ?? 0)} (objectif 1 s), ${r.requests} requêtes en 24 h`, level: (r.p95 ?? 0) > 3000 ? "bad" : "warn" });
  }
  for (const p of input.phonePages.filter((p) => (p.LCP ?? 0) > 2500).slice(0, 2)) {
    out.push({ title: `Alléger la page ${p.page}`, why: `affichée en ${fmtMs(p.LCP ?? 0)} sur téléphone (objectif 2,5 s)`, level: (p.LCP ?? 0) > 4000 ? "bad" : "warn" });
  }

  // Motifs d'annulation en hausse sur 7 jours.
  const before = new Map(cancelBefore.map((g) => [g.cancellationReason, g._count._all]));
  for (const g of cancelNow) {
    const n = g._count._all;
    const prev = before.get(g.cancellationReason) ?? 0;
    if (n >= 5 && n >= prev * 1.5 && g.cancellationReason) {
      out.push({ title: `Annulations en hausse : ${g.cancellationReason.slice(0, 50)}`, why: `${n} en 7 jours, ${prev} la semaine d'avant`, level: "warn" });
    }
  }

  return out.sort((a, b) => RANK[a.level] - RANK[b.level]).slice(0, limit);
}
