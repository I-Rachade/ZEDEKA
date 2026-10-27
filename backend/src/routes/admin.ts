import { Router } from "express";
import type { OrderStatus, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { checkPassword, issueToken, requireAdmin } from "../auth.js";
import { BREAK_EVEN_PER_DAY, buildReport, startOfDayUtc, zedekaRevenue } from "../stats.js";

type AdminConfig = { adminPassword: string; adminSecret: string };

const STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "DELIVERED", "CANCELLED"] as const;

const STATUS_TIMESTAMP: Partial<Record<OrderStatus, "confirmedAt" | "pickedUpAt" | "deliveredAt" | "cancelledAt">> = {
  CONFIRMED: "confirmedAt",
  PICKED_UP: "pickedUpAt",
  DELIVERED: "deliveredAt",
  CANCELLED: "cancelledAt",
};

const slug = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug : minuscules, chiffres et tirets");
const phone = z.string().trim().regex(/^\+?[0-9 ]{8,15}$/, "Numéro de téléphone invalide");
const amount = z.number().int().min(0).max(1_000_000);

const restaurantInput = z.object({
  slug,
  name: z.string().trim().min(2),
  phone,
  address: z.string().trim().min(2),
  commissionRate: z.number().int().min(0).max(50).default(10),
  active: z.boolean().default(true),
});

const menuItemInput = z.object({
  category: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().max(300).nullish(),
  price: amount,
  available: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const zoneInput = z.object({ name: z.string().trim().min(2), deliveryFee: amount, active: z.boolean().default(true) });
const driverInput = z.object({ name: z.string().trim().min(2), phone, active: z.boolean().default(true) });

const orderPatch = z.object({
  status: z.enum(STATUSES).optional(),
  driverId: z.string().nullable().optional(),
});

function firstError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Données invalides";
  return issue.path.length ? `${issue.path.join(".")} : ${issue.message}` : issue.message;
}

// Prisma P2002 = contrainte d'unicité, P2025 = enregistrement introuvable.
function prismaError(e: unknown): { status: number; error: string } | null {
  const code = (e as { code?: string }).code;
  if (code === "P2002") return { status: 409, error: "Cette valeur existe déjà" };
  if (code === "P2025") return { status: 404, error: "Introuvable" };
  return null;
}

export function adminRouter(prisma: PrismaClient, config: AdminConfig) {
  const router = Router();

  router.post("/login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!checkPassword(password, config.adminPassword)) {
      res.status(401).json({ error: "Mot de passe incorrect" });
      return;
    }
    res.json({ token: issueToken(config.adminSecret) });
  });

  router.use(requireAdmin(config.adminSecret));

  // Crée un gestionnaire create/update générique qui traduit les erreurs Prisma.
  const write =
    <T>(schema: z.ZodType<T>, action: (data: T, id?: string) => Promise<unknown>, partial = false) =>
    async (req: { body: unknown; params: Record<string, string> }, res: import("express").Response) => {
      const parsed = (partial ? (schema as unknown as z.AnyZodObject).partial() : schema).safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstError(parsed.error) });
        return;
      }
      try {
        res.status(partial ? 200 : 201).json(await action(parsed.data as T, req.params.id));
      } catch (e) {
        const known = prismaError(e);
        if (!known) throw e;
        res.status(known.status).json({ error: known.error });
      }
    };

  router.get("/dashboard", async (_req, res) => {
    const today = startOfDayUtc(new Date());
    const [todayOrders, pendingByStatus, recent] = await Promise.all([
      prisma.order.findMany({
        where: { createdAt: { gte: today }, status: { not: "CANCELLED" } },
        select: { deliveryFee: true, commission: true, total: true },
      }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true }, where: { createdAt: { gte: today } } }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          code: true,
          status: true,
          total: true,
          createdAt: true,
          restaurant: { select: { name: true } },
          driver: { select: { name: true } },
        },
      }),
    ]);
    const revenue = todayOrders.reduce((sum, o) => sum + zedekaRevenue(o), 0);
    res.json({
      today: {
        orders: todayOrders.length,
        revenue,
        orderValue: todayOrders.reduce((sum, o) => sum + o.total, 0),
        breakEven: BREAK_EVEN_PER_DAY,
      },
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, pendingByStatus.find((g) => g.status === s)?._count._all ?? 0])),
      recent,
    });
  });

  router.get("/report", async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 92);
    const from = new Date(startOfDayUtc(new Date()).getTime() - (days - 1) * 86_400_000);
    const orders = await prisma.order.findMany({
      where: { createdAt: { gte: from } },
      select: {
        status: true,
        deliveryFee: true,
        commission: true,
        createdAt: true,
        deliveredAt: true,
        restaurant: { select: { name: true } },
      },
    });
    res.json(buildReport(orders.map((o) => ({ ...o, restaurantName: o.restaurant.name })), from, days));
  });

  // --- Commandes ---

  router.get("/orders", async (req, res) => {
    const status = STATUSES.find((s) => s === req.query.status);
    const orders = await prisma.order.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        restaurant: { select: { name: true, phone: true } },
        zone: { select: { name: true } },
        driver: { select: { id: true, name: true } },
        items: { select: { name: true, quantity: true, unitPrice: true } },
      },
    });
    res.json(orders);
  });

  router.patch(
    "/orders/:id",
    write(
      orderPatch,
      async (data, id) => {
        const timestamp = data.status ? STATUS_TIMESTAMP[data.status] : undefined;
        return prisma.order.update({
          where: { id },
          data: {
            ...(data.status && { status: data.status }),
            ...(data.driverId !== undefined && { driverId: data.driverId }),
            ...(timestamp && { [timestamp]: new Date() }),
          },
          include: { driver: { select: { id: true, name: true } } },
        });
      },
      true,
    ),
  );

  // --- Restaurants et cartes ---

  router.get("/restaurants", async (_req, res) => {
    res.json(
      await prisma.restaurant.findMany({
        orderBy: { name: "asc" },
        include: { _count: { select: { orders: true, menuItems: true } } },
      }),
    );
  });

  router.get("/restaurants/:id", async (req, res) => {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: req.params.id },
      include: { menuItems: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
    });
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    res.json(restaurant);
  });

  router.post("/restaurants", write(restaurantInput, (data) => prisma.restaurant.create({ data })));
  router.patch(
    "/restaurants/:id",
    write(restaurantInput, (data, id) => prisma.restaurant.update({ where: { id }, data }), true),
  );

  router.post(
    "/restaurants/:id/items",
    write(menuItemInput, (data, id) => prisma.menuItem.create({ data: { ...data, restaurantId: id! } })),
  );
  router.patch("/items/:id", write(menuItemInput, (data, id) => prisma.menuItem.update({ where: { id }, data }), true));

  // --- Zones ---

  router.get("/zones", async (_req, res) => {
    res.json(await prisma.zone.findMany({ orderBy: { deliveryFee: "asc" } }));
  });
  router.post("/zones", write(zoneInput, (data) => prisma.zone.create({ data })));
  router.patch("/zones/:id", write(zoneInput, (data, id) => prisma.zone.update({ where: { id }, data }), true));

  // --- Livreurs ---

  router.get("/drivers", async (_req, res) => {
    const drivers = await prisma.driver.findMany({ orderBy: { name: "asc" } });
    const today = startOfDayUtc(new Date());
    const counts = await prisma.order.groupBy({
      by: ["driverId"],
      _count: { _all: true },
      where: { createdAt: { gte: today }, status: { not: "CANCELLED" }, driverId: { not: null } },
    });
    res.json(drivers.map((d) => ({ ...d, ordersToday: counts.find((c) => c.driverId === d.id)?._count._all ?? 0 })));
  });
  router.post("/drivers", write(driverInput, (data) => prisma.driver.create({ data })));
  router.patch("/drivers/:id", write(driverInput, (data, id) => prisma.driver.update({ where: { id }, data }), true));

  return router;
}
