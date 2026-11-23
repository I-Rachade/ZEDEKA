import type { PrismaClient } from "@prisma/client";
import { bucketOf } from "./apiMetrics.js";
import { PRESENCE_APPS } from "./live.js";

// Relevés de l'écran technique, écrits par le cron toutes les 5 minutes dans TechSample : utilisateurs en ligne par
// appli (« online:client »…) et au total (« online:total »). Ils servent à la courbe de la journée et aux comparaisons.

// Compte des connexions « presence:<appli> » ouvertes (Durable Object Live) ; absent dans les tests.
export type OnlineCounter = () => Promise<Record<string, number>>;

export type Online = { total: number; byApp: Record<string, number> } | null;

export async function onlineNow(counter: OnlineCounter | undefined): Promise<Online> {
  if (!counter) return null;
  try {
    const raw = await counter();
    const byApp = Object.fromEntries(PRESENCE_APPS.map((a) => [a, Math.max(0, Math.round(Number(raw[a]) || 0))])) as Record<string, number>;
    return { total: Object.values(byApp).reduce((a, b) => a + b, 0), byApp };
  } catch (e) {
    console.error("utilisateurs en ligne", e);
    return null;
  }
}

export async function writeSamples(prisma: PrismaClient, values: Record<string, number>, at = Date.now()) {
  const bucket = bucketOf(at);
  const entries = Object.entries(values).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "TechSample" ("bucket", "metric", "value") VALUES ${entries.map(() => "(?, ?, ?)").join(", ")} ` +
      `ON CONFLICT ("bucket", "metric") DO UPDATE SET "value" = excluded."value"`,
    ...entries.flatMap(([metric, value]) => [bucket, metric, value]),
  );
}

// Cron, toutes les 5 minutes : utilisateurs en ligne.
export async function sampleOnline(prisma: PrismaClient, counter: OnlineCounter | undefined, at = Date.now()) {
  const online = await onlineNow(counter);
  if (!online) return null;
  await writeSamples(prisma, { "online:total": online.total, ...Object.fromEntries(Object.entries(online.byApp).map(([a, v]) => [`online:${a}`, v])) }, at);
  return online;
}
