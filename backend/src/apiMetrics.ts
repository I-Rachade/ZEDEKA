import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";

// Performance de l'API mesurée par le serveur lui-même, sans service extérieur : chaque réponse est comptée en
// mémoire (route sans identifiant, code de réponse, durée), puis les compteurs sont ajoutés en une fois dans D1
// (table ApiMetric, une ligne par tranche de 5 minutes et par route). Rien sur la personne : ni compte, ni adresse IP.

export const BUCKET_SECONDS = 300;
// Limites des tranches de durée (ms) ; la dernière colonne compte ce qui dépasse 5 s.
export const LATENCY_BOUNDS = [50, 100, 200, 500, 1000, 2000, 5000] as const;
export const HIST_COLUMNS = ["h50", "h100", "h200", "h500", "h1000", "h2000", "h5000", "hMore"] as const;
// Au plus tant de routes distinctes gardées entre deux envois (au-delà : « autre »), pour borner la mémoire et D1.
const MAX_ROUTES = 150;
// Les compteurs partent dans D1 au plus tard 2 minutes après la première réponse comptée.
const FLUSH_AFTER_MS = 120_000;
// Paramètres par ligne dans l'INSERT ; D1 accepte 100 paramètres par requête.
const COLUMNS = ["bucket", "route", "count", "errors", "clientErrors", "totalMs", "maxMs", ...HIST_COLUMNS] as const;
const ROWS_PER_STATEMENT = Math.floor(100 / COLUMNS.length);
// Colonnes additionnées quand la ligne existe déjà (une autre instance du Worker a compté la même tranche).
const ADDED = ["count", "errors", "clientErrors", "totalMs", ...HIST_COLUMNS] as const;

export type MetricRow = {
  bucket: number;
  route: string;
  count: number;
  errors: number;
  clientErrors: number;
  totalMs: number;
  maxMs: number;
  hist: number[];
};

export const bucketOf = (ms: number) => Math.floor(ms / 1000 / BUCKET_SECONDS) * BUCKET_SECONDS;

export function histIndex(ms: number): number {
  const i = LATENCY_BOUNDS.findIndex((b) => ms < b);
  return i === -1 ? LATENCY_BOUNDS.length : i;
}

// Nom de route stable : le motif Express quand il est connu (« /api/orders/:code »), sinon les premiers segments
// du chemin sans ce qui ressemble à un identifiant.
export function routeName(req: Pick<Request, "method" | "baseUrl" | "originalUrl"> & { route?: { path?: unknown } }): string {
  const method = req.method.toUpperCase();
  const pattern = typeof req.route?.path === "string" ? `${req.baseUrl}${req.route.path}` : null;
  if (pattern) return `${method} ${pattern}`.slice(0, 120);
  const path = req.originalUrl.split("?")[0];
  const parts = path.split("/").filter(Boolean).slice(0, 3).map((s) => (/^[a-z][a-z-]{0,30}$/.test(s) ? s : ":id"));
  return `${method} /${parts.join("/")} (sans route)`.slice(0, 120);
}

export type Metrics = {
  record: (route: string, status: number, ms: number, at?: number) => void;
  // Ajoute les compteurs en attente dans D1 (sans attendre de requête suivante) ; ne lève jamais.
  flush: () => Promise<void>;
  // Battement du cron, une fois par minute : la base répond-elle, et en combien de temps.
  heartbeat: (ok: boolean, ms: number, at?: number) => Promise<void>;
  pending: () => MetricRow[];
};

export function createMetrics(prisma: PrismaClient, opts: { background?: (p: Promise<unknown>) => void; now?: () => number } = {}): Metrics {
  const now = opts.now ?? Date.now;
  let rows = new Map<string, MetricRow>();
  let firstAt: number | null = null;
  let flushing: Promise<void> | null = null;

  function add(target: Map<string, MetricRow>, bucket: number, route: string, status: number, ms: number) {
    const key = `${bucket}|${route}`;
    let row = target.get(key);
    if (!row) {
      row = { bucket, route, count: 0, errors: 0, clientErrors: 0, totalMs: 0, maxMs: 0, hist: HIST_COLUMNS.map(() => 0) };
      target.set(key, row);
    }
    const t = Math.max(0, Math.round(ms));
    row.count++;
    if (status >= 500) row.errors++;
    else if (status >= 400) row.clientErrors++;
    row.totalMs += t;
    row.maxMs = Math.max(row.maxMs, t);
    row.hist[histIndex(t)]++;
  }

  async function write(list: MetricRow[]) {
    for (let i = 0; i < list.length; i += ROWS_PER_STATEMENT) {
      const chunk = list.slice(i, i + ROWS_PER_STATEMENT);
      const values = chunk.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ");
      const params = chunk.flatMap((r) => [r.bucket, r.route, r.count, r.errors, r.clientErrors, r.totalMs, r.maxMs, ...r.hist]);
      const sum = ADDED.map((c) => `"${c}" = "${c}" + excluded."${c}"`);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ApiMetric" (${COLUMNS.map((c) => `"${c}"`).join(", ")}) VALUES ${values} ` +
          `ON CONFLICT ("bucket", "route") DO UPDATE SET ${[...sum, `"maxMs" = MAX("maxMs", excluded."maxMs")`].join(", ")}`,
        ...params,
      );
    }
  }

  function flush(): Promise<void> {
    if (flushing) return flushing;
    if (!rows.size) return Promise.resolve();
    const list = [...rows.values()];
    rows = new Map();
    firstAt = null;
    flushing = write(list)
      .catch((e) => console.error("mesures de l'API", e))
      .finally(() => {
        flushing = null;
      });
    return flushing;
  }

  return {
    record(route, status, ms, at = now()) {
      const bucket = bucketOf(at);
      const name = rows.size >= MAX_ROUTES && !rows.has(`${bucket}|${route}`) ? "autre" : route;
      add(rows, bucket, name, status, ms);
      firstAt ??= at;
      if (at - firstAt >= FLUSH_AFTER_MS) {
        const p = flush();
        opts.background?.(p);
      }
    },
    flush,
    async heartbeat(ok, ms, at = now()) {
      const one = new Map<string, MetricRow>();
      add(one, bucketOf(at), "cron", ok ? 200 : 500, ms);
      await write([...one.values()]).catch((e) => console.error("battement", e));
    },
    pending: () => [...rows.values()],
  };
}

// Middleware Express : compte chaque réponse de l'API à la fin de son envoi.
export function metricsMiddleware(metrics: Metrics | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!metrics) return next();
    const start = Date.now();
    res.on("finish", () => {
      try {
        metrics.record(routeName(req), res.statusCode, Date.now() - start);
      } catch {
        // La mesure ne doit jamais gêner la réponse.
      }
    });
    next();
  };
}

// Temps sous lequel tombent p % des réponses, estimé depuis la répartition par tranches (interpolation linéaire).
export function percentileFromHist(hist: number[], p: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const target = total * p;
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    if (seen + hist[i] >= target && hist[i] > 0) {
      const low = i === 0 ? 0 : LATENCY_BOUNDS[i - 1];
      const high = i < LATENCY_BOUNDS.length ? LATENCY_BOUNDS[i] : LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1] * 2;
      return Math.round(low + ((target - seen) / hist[i]) * (high - low));
    }
    seen += hist[i];
  }
  return LATENCY_BOUNDS[LATENCY_BOUNDS.length - 1] * 2;
}
