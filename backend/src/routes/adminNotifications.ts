import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { parseMuted } from "../notify.js";
import { notificationCategoriesFor, type Staff } from "../team.js";
import { firstError } from "../util.js";

// Centre de notifications de l'admin : fil des événements que le rôle du membre reçoit, nombre de non lues,
// et catégories coupées (sans pop-up ni son). Les réglages suivent le compte, sur tous ses navigateurs.

const subjectOf = (staff: Staff) => staff.id ?? "admin";

export function adminNotificationsRouter(prisma: PrismaClient) {
  const router = Router();

  async function prefsOf(subject: string) {
    // Premier passage : le fil commence « lu », pour ne pas afficher 30 jours d'anciens événements comme nouveaux.
    return prisma.staffNotificationPrefs.upsert({ where: { subject }, update: {}, create: { subject } });
  }

  router.get("/notifications", async (req, res) => {
    const staff = res.locals.staff as Staff;
    const categories = notificationCategoriesFor(staff.role);
    const wanted = typeof req.query.category === "string" && categories.includes(req.query.category as never) ? [req.query.category] : categories;
    const after = typeof req.query.after === "string" && !Number.isNaN(Date.parse(req.query.after)) ? new Date(req.query.after) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const prefs = await prefsOf(subjectOf(staff));
    const [items, unread] = await Promise.all([
      prisma.staffNotification.findMany({
        where: { category: { in: wanted }, ...(after ? { createdAt: { gt: after } } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
      prisma.staffNotification.count({ where: { category: { in: categories }, createdAt: { gt: prefs.seenAt } } }),
    ]);
    res.json({ items, unread, seenAt: prefs.seenAt, categories, muted: parseMuted(prefs.muted).filter((c) => categories.includes(c as never)) });
  });

  // Fil ouvert : tout ce qui est arrivé jusqu'ici est lu.
  router.post("/notifications/seen", async (_req, res) => {
    const subject = subjectOf(res.locals.staff as Staff);
    const seenAt = new Date();
    await prisma.staffNotificationPrefs.upsert({ where: { subject }, update: { seenAt }, create: { subject, seenAt } });
    res.json({ unread: 0, seenAt });
  });

  router.put("/notifications/prefs", async (req, res) => {
    const staff = res.locals.staff as Staff;
    const categories = notificationCategoriesFor(staff.role);
    const parsed = z.object({ muted: z.array(z.string()).max(20) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const muted = [...new Set(parsed.data.muted.filter((c) => categories.includes(c as never)))];
    const subject = subjectOf(staff);
    await prisma.staffNotificationPrefs.upsert({ where: { subject }, update: { muted: JSON.stringify(muted) }, create: { subject, muted: JSON.stringify(muted) } });
    res.json({ muted });
  });

  return router;
}
