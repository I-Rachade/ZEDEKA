import { Router, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { availability } from "../openingHours.js";
import {
  LEAD_MS,
  MAX_WEEKS,
  nextDelivery,
  parseDays,
  plannedInput,
  PlanError,
  quotePlanned,
  scheduleError,
  hhmmOf,
} from "../plannedMeals.js";
import { firstError } from "../util.js";

// Repas planifiés et formule cantine : côté client (/api/customer/planned-meals, compte requis) et admin
// (/api/admin/planned-meals, lecture et annulation). Voir src/plannedMeals.ts.

const listSelect = {
  id: true,
  kind: true,
  restaurantId: true,
  deliverTime: true,
  days: true,
  deliverAt: true,
  endsAt: true,
  nextRunAt: true,
  status: true,
  estimate: true,
  items: true,
  address: true,
  lastError: true,
  createdAt: true,
  runs: { orderBy: { deliverAt: "desc" as const }, take: 10, select: { deliverAt: true, orderCode: true, error: true } },
};

type Row = { items: string; days: string | null; restaurantId: string };
async function withRestaurants<T extends Row>(prisma: PrismaClient, rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.restaurantId))];
  const restaurants = ids.length ? await prisma.restaurant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true, logoUrl: true } }) : [];
  const items = new Set(rows.flatMap((r) => (JSON.parse(r.items) as { menuItemId: string }[]).map((i) => i.menuItemId)));
  const names = items.size ? await prisma.menuItem.findMany({ where: { id: { in: [...items] } }, select: { id: true, name: true } }) : [];
  return rows.map(({ items: raw, days, ...r }) => ({
    ...r,
    days: parseDays(days),
    restaurant: restaurants.find((x) => x.id === r.restaurantId) ?? null,
    items: (JSON.parse(raw) as { menuItemId: string; quantity: number }[]).map((i) => ({ name: names.find((n) => n.id === i.menuItemId)?.name ?? "Plat retiré", quantity: i.quantity })),
  }));
}

function fail(res: Response, e: unknown) {
  if (e instanceof PlanError) return void res.status(400).json({ error: e.message });
  throw e;
}

export function plannedMealCustomerRoutes(router: Router, prisma: PrismaClient) {
  router.get("/planned-meals", async (_req, res) => {
    const rows = await prisma.plannedMeal.findMany({
      where: { customerId: res.locals.customerId, status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: { nextRunAt: "asc" },
      take: 50,
      select: listSelect,
    });
    res.json(await withRestaurants(prisma, rows));
  });

  router.post("/planned-meals", async (req, res) => {
    const parsed = plannedInput.safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ error: firstError(parsed.error) });
    const input = parsed.data;
    const now = new Date();
    const active = await prisma.plannedMeal.count({ where: { customerId: res.locals.customerId, status: { in: ["ACTIVE", "PAUSED"] } } });
    if (active >= 10) return void res.status(400).json({ error: "Vous avez déjà 10 repas planifiés : annulez-en un d'abord" });
    const restaurant = await prisma.restaurant.findFirst({
      where: { slug: input.restaurantSlug, active: true, deletedAt: null },
      select: { id: true, name: true, zoneId: true, latitude: true, longitude: true, minOrderAmount: true, active: true, temporarilyClosed: true, closedUntil: true, openingHours: true },
    });
    if (!restaurant) return void res.status(404).json({ error: "Restaurant introuvable" });

    const weekly = input.kind === "WEEKLY";
    const deliverAt = weekly ? null : new Date(input.deliverAt!);
    const deliverTime = weekly ? input.time! : hhmmOf(deliverAt!);
    const days = weekly ? [...new Set(input.days!)].sort().join(",") : null;
    // Formule : du premier jour possible (au moins 1 h 30 après maintenant) à la fin de la dernière semaine.
    const endsAt = weekly ? new Date(now.getTime() + input.weeks * 7 * 86_400_000) : null;
    const schedule = { kind: input.kind, deliverAt, deliverTime, days, endsAt };
    const first = weekly ? nextDelivery(schedule, new Date(now.getTime() + 90 * 60_000 - 1)) : deliverAt;
    const problem = scheduleError(input.kind, first, now);
    if (problem) return void res.status(400).json({ error: problem });
    // Le restaurant doit être ouvert au moment où la commande lui est envoyée (60 min avant).
    const open = availability(restaurant, new Date(first!.getTime() - LEAD_MS));
    if (!open.open) return void res.status(400).json({ error: `Le restaurant sera fermé à cette heure : choisissez une autre heure. ${open.reason ?? ""}`.trim() });

    try {
      const { priced } = await quotePlanned(prisma, restaurant, { latitude: input.latitude, longitude: input.longitude }, input.items);
      const plan = await prisma.plannedMeal.create({
        data: {
          customerId: res.locals.customerId,
          restaurantId: restaurant.id,
          kind: input.kind,
          items: JSON.stringify(input.items),
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          address: input.address,
          latitude: input.latitude,
          longitude: input.longitude,
          note: input.note || null,
          deliverTime,
          days,
          deliverAt,
          endsAt,
          nextRunAt: first,
          estimate: priced.total,
        },
        select: listSelect,
      });
      const [view] = await withRestaurants(prisma, [plan]);
      res.status(201).json(view);
    } catch (e) {
      fail(res, e);
    }
  });

  // Pause, reprise ou annulation. Une commande déjà envoyée au restaurant suit son cours (annulable dans son suivi).
  router.post("/planned-meals/:id/:action", async (req, res) => {
    const action = z.enum(["pause", "resume", "cancel"]).safeParse(req.params.action);
    if (!action.success) return void res.status(404).json({ error: "Action inconnue" });
    const plan = await prisma.plannedMeal.findFirst({ where: { id: String(req.params.id), customerId: res.locals.customerId } });
    if (!plan || !["ACTIVE", "PAUSED"].includes(plan.status)) return void res.status(404).json({ error: "Repas planifié introuvable" });
    const now = new Date();
    if (action.data === "cancel") await prisma.plannedMeal.update({ where: { id: plan.id }, data: { status: "CANCELLED", nextRunAt: null } });
    else if (action.data === "pause") await prisma.plannedMeal.update({ where: { id: plan.id }, data: { status: "PAUSED" } });
    else {
      const next = nextDelivery(plan, new Date(now.getTime() + LEAD_MS));
      if (!next) return void res.status(400).json({ error: "Plus aucune livraison possible : planifiez un nouveau repas" });
      await prisma.plannedMeal.update({ where: { id: plan.id }, data: { status: "ACTIVE", nextRunAt: next } });
    }
    res.json({ ok: true });
  });
}

// Admin : repas planifiés à venir (pour prévenir les restaurants des gros volumes), et annulation.
export function adminPlannedMealsRouter(prisma: PrismaClient) {
  const router = Router();
  router.get("/planned-meals", async (_req, res) => {
    const rows = await prisma.plannedMeal.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED"] } },
      orderBy: { nextRunAt: "asc" },
      take: 200,
      select: { ...listSelect, customerName: true, customerPhone: true },
    });
    res.json({ maxWeeks: MAX_WEEKS, plans: await withRestaurants(prisma, rows) });
  });
  router.post("/planned-meals/:id/cancel", async (req, res) => {
    const { count } = await prisma.plannedMeal.updateMany({ where: { id: String(req.params.id), status: { in: ["ACTIVE", "PAUSED"] } }, data: { status: "CANCELLED", nextRunAt: null } });
    if (!count) return void res.status(404).json({ error: "Repas planifié introuvable" });
    res.json({ ok: true });
  });
  return router;
}
