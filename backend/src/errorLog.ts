import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { bucketOf, routeName } from "./apiMetrics.js";

// Journal des erreurs de l'écran technique : erreurs du serveur (réponses 5xx) et plantages d'écran envoyés par les
// téléphones. Les erreurs identiques sont regroupées par empreinte (source, route, code, message raccourci) et par
// tranche de 5 minutes, avec un compteur : une rafale de 500 erreurs fait une ligne, pas 500.
// Rien sur la personne : ni compte, ni adresse IP ; le message perd ses chiffres, adresses e-mail et liens.

export const ERROR_SOURCES = ["api", "cron", "client", "livreur", "restaurant", "marchand", "admin"] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];
export type ErrorInput = { source: ErrorSource; route: string; status?: number; message: string };

type Row = { bucket: number; fingerprint: string; source: string; route: string; status: number; message: string; count: number; lastAt: number };

const MESSAGE_MAX = 160;
const ROUTE_MAX = 120;
// Au plus tant d'erreurs différentes gardées entre deux écritures (au-delà : comptées dans « autres erreurs »).
const MAX_KEYS = 100;
const COLUMNS = ["bucket", "fingerprint", "source", "route", "status", "message", "count", "lastAt"] as const;
const ROWS_PER_STATEMENT = Math.floor(100 / COLUMNS.length);

// Message lisible et sans donnée personnelle : liens, adresses e-mail, nombres (téléphones, montants, ids) et longs
// identifiants remplacés, espaces resserrés.
export function cleanMessage(raw: unknown): string {
  const text = raw instanceof Error ? raw.message || raw.name : typeof raw === "string" ? raw : String(raw ?? "");
  const cleaned = text
    .slice(0, 2000)
    .replace(/https?:\/\/\S+/gi, "<lien>")
    .replace(/[^\s@]{1,64}@[^\s@]{1,255}/g, "<e-mail>")
    .replace(/\b[0-9a-z]{20,}\b/gi, "<id>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Erreur sans message").slice(0, MESSAGE_MAX);
}

export const fingerprintOf = (e: { source: string; route: string; status: number; message: string }) =>
  createHash("sha256").update(`${e.source}|${e.route}|${e.status}|${e.message}`).digest("hex").slice(0, 20);

export type ErrorLog = {
  record: (e: ErrorInput, at?: number) => void;
  // Écrit les erreurs en attente dans D1 ; ne lève jamais.
  flush: () => Promise<void>;
  pending: () => Row[];
};

export function createErrorLog(
  prisma: PrismaClient,
  opts: { background?: (p: Promise<unknown>) => void; now?: () => number; onWritten?: () => void; gatherMs?: number } = {},
): ErrorLog {
  const now = opts.now ?? Date.now;
  const gatherMs = opts.gatherMs ?? 100;
  let rows = new Map<string, Row>();
  let flushing: Promise<void> | null = null;

  async function write(list: Row[]) {
    for (let i = 0; i < list.length; i += ROWS_PER_STATEMENT) {
      const chunk = list.slice(i, i + ROWS_PER_STATEMENT);
      const values = chunk.map(() => `(${COLUMNS.map(() => "?").join(", ")})`).join(", ");
      const params = chunk.flatMap((r) => [r.bucket, r.fingerprint, r.source, r.route, r.status, r.message, r.count, r.lastAt]);
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ErrorEvent" (${COLUMNS.map((c) => `"${c}"`).join(", ")}) VALUES ${values} ` +
          `ON CONFLICT ("bucket", "fingerprint") DO UPDATE SET "count" = "count" + excluded."count", "lastAt" = MAX("lastAt", excluded."lastAt")`,
        ...params,
      );
    }
  }

  // Les erreurs sont rares : elles partent presque tout de suite (l'écran technique les montre en direct), après
  // une courte attente qui regroupe une rafale en une écriture. Celles qui arrivent pendant l'écriture partent dans
  // la suivante.
  function flush(): Promise<void> {
    if (flushing) return flushing;
    if (!rows.size) return Promise.resolve();
    flushing = (async () => {
      if (gatherMs > 0) await new Promise((r) => setTimeout(r, gatherMs));
      while (rows.size) {
        const list = [...rows.values()];
        rows = new Map();
        await write(list).catch((e) => console.error("journal des erreurs", e));
      }
      opts.onWritten?.();
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  return {
    record(e, at = now()) {
      try {
        const route = e.route.slice(0, ROUTE_MAX) || "?";
        const status = Math.max(0, Math.min(999, Math.round(e.status ?? 0)));
        const message = cleanMessage(e.message);
        let fingerprint = fingerprintOf({ source: e.source, route, status, message });
        const bucket = bucketOf(at);
        let key = `${bucket}|${fingerprint}`;
        let row = rows.get(key);
        if (!row && rows.size >= MAX_KEYS - 1) {
          fingerprint = "autres";
          key = `${bucket}|${fingerprint}`;
          row = rows.get(key);
          row ??= { bucket, fingerprint, source: e.source, route: "?", status: 0, message: "Autres erreurs", count: 0, lastAt: 0 };
        }
        row ??= { bucket, fingerprint, source: e.source, route, status, message, count: 0, lastAt: 0 };
        row.count++;
        row.lastAt = Math.max(row.lastAt, Math.floor(at / 1000));
        rows.set(key, row);
        const p = flush();
        opts.background?.(p);
      } catch {
        // Le journal ne doit jamais gêner la réponse.
      }
    },
    flush,
    pending: () => [...rows.values()],
  };
}

// Middleware Express : chaque réponse 5xx de l'API entre dans le journal, avec le message laissé par le
// gestionnaire d'erreurs (res.locals.errorMessage) quand il y en a un.
export function errorCapture(log: ErrorLog | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!log) return next();
    res.on("finish", () => {
      if (res.statusCode < 500) return;
      const message = typeof res.locals.errorMessage === "string" ? res.locals.errorMessage : `Réponse ${res.statusCode}`;
      log.record({ source: "api", route: routeName(req), status: res.statusCode, message });
    });
    next();
  };
}

export type RecentError = { fingerprint: string; source: string; route: string; status: number; message: string; count: number; lastAt: string };

// Erreurs des `minutes` dernières minutes, regroupées par empreinte, les plus récentes d'abord.
export async function recentErrors(prisma: PrismaClient, minutes = 60, limit = 30, now = new Date()): Promise<RecentError[]> {
  const since = Math.floor(now.getTime() / 1000) - minutes * 60;
  const rows = await prisma.errorEvent.findMany({ where: { lastAt: { gte: since } }, orderBy: { lastAt: "desc" }, take: 500 });
  const byPrint = new Map<string, RecentError & { last: number }>();
  for (const r of rows) {
    const seen = byPrint.get(r.fingerprint);
    if (seen) {
      seen.count += r.count;
      continue;
    }
    byPrint.set(r.fingerprint, {
      fingerprint: r.fingerprint,
      source: r.source,
      route: r.route,
      status: r.status,
      message: r.message,
      count: r.count,
      last: r.lastAt,
      lastAt: new Date(r.lastAt * 1000).toISOString(),
    });
  }
  return [...byPrint.values()]
    .sort((a, b) => b.last - a.last)
    .slice(0, limit)
    .map(({ last: _last, ...e }) => e);
}
