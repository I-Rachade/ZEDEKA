import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { recentErrors } from "../errorLog.js";
import { PRESENCE_APPS } from "../live.js";
import { onlineNow, type OnlineCounter } from "../techSamples.js";
import { dayOf } from "./techSignals.js";

// Écran technique, partie « en direct » (directeur et administrateur adjoint) : utilisateurs en ligne par appli,
// actifs du jour, courbe de la journée comparée à la semaine dernière, et erreurs de la dernière heure.
export function adminTechRouter(prisma: PrismaClient, config: { online?: OnlineCounter; now?: () => Date }) {
  const router = Router();
  router.get("/tech/live", async (_req, res) => {
    res.json(await techLive(prisma, config.online, (config.now ?? (() => new Date()))()));
  });
  return router;
}

const WEEK_SEC = 7 * 86_400;

export async function techLive(prisma: PrismaClient, online: OnlineCounter | undefined, now = new Date()) {
  const nowSec = Math.floor(now.getTime() / 1000);
  const dayStartSec = Math.floor(Date.parse(`${dayOf(now)}T00:00:00Z`) / 1000);
  const [counts, active, today, lastWeek, errors] = await Promise.all([
    onlineNow(online),
    prisma.activeDay.groupBy({ by: ["app"], where: { day: dayOf(now) }, _count: { _all: true } }),
    prisma.techSample.findMany({ where: { metric: "online:total", bucket: { gte: dayStartSec } }, orderBy: { bucket: "asc" }, select: { bucket: true, value: true } }),
    prisma.techSample.findMany({
      where: { metric: "online:total", bucket: { gte: dayStartSec - WEEK_SEC, lt: dayStartSec - WEEK_SEC + 86_400 } },
      orderBy: { bucket: "asc" },
      select: { bucket: true, value: true },
    }),
    recentErrors(prisma, 60, 30, now),
  ]);
  const activeByApp = Object.fromEntries(PRESENCE_APPS.map((a) => [a, 0])) as Record<string, number>;
  for (const g of active) activeByApp[g.app] = g._count._all;
  // Même heure la semaine dernière : le relevé le plus proche avant ce moment-là.
  const sameTime = [...lastWeek].reverse().find((s) => s.bucket <= nowSec - WEEK_SEC)?.value ?? null;
  return {
    checkedAt: now.toISOString(),
    online: counts,
    onlineLastWeek: sameTime,
    activeToday: { total: Object.values(activeByApp).reduce((a, b) => a + b, 0), byApp: activeByApp },
    today: today.map((s) => ({ at: new Date(s.bucket * 1000).toISOString(), value: s.value })),
    lastWeek: lastWeek.map((s) => ({ at: new Date((s.bucket + WEEK_SEC) * 1000).toISOString(), value: s.value })),
    errors,
  };
}
