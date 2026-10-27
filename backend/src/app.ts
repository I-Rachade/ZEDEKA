import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { orderCode, priceOrder, whatsappMessage, whatsappUrl } from "./pricing.js";
import { vendorApplicationsRouter } from "./routes/vendorApplications.js";

const orderInput = z.object({
  restaurantSlug: z.string().min(1),
  zoneId: z.string().min(1),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: z.string().trim().regex(/^\+?[0-9 ]{8,15}$/, "Numéro de téléphone invalide"),
  address: z.string().trim().min(5).max(300),
  note: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(["CASH", "MOBILE_MONEY"]),
  items: z
    .array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(50) }))
    .min(1, "Le panier est vide"),
});

type Config = { frontendOrigin: string; zedekaWhatsapp: string; uploadDir?: string };

export function createApp(prisma: PrismaClient, config: Config) {
  const app = express();
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/zones", async (_req, res) => {
    const zones = await prisma.zone.findMany({
      where: { active: true },
      orderBy: { deliveryFee: "asc" },
      select: { id: true, name: true, deliveryFee: true },
    });
    res.json(zones);
  });

  app.get("/api/restaurants/:slug", async (req, res) => {
    const restaurant = await prisma.restaurant.findFirst({
      where: { slug: req.params.slug, active: true },
      select: {
        slug: true,
        name: true,
        address: true,
        menuItems: {
          where: { available: true },
          orderBy: { sortOrder: "asc" },
          select: { id: true, category: true, name: true, description: true, price: true },
        },
      },
    });
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    res.json(restaurant);
  });

  app.post("/api/orders", async (req, res) => {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const error =
        issue?.code === "invalid_type" && issue.received === "undefined"
          ? `Champ manquant : ${issue.path.join(".")}`
          : (issue?.message ?? "Commande invalide");
      res.status(400).json({ error });
      return;
    }
    const input = parsed.data;

    const [restaurant, zone] = await Promise.all([
      prisma.restaurant.findFirst({ where: { slug: input.restaurantSlug, active: true } }),
      prisma.zone.findFirst({ where: { id: input.zoneId, active: true } }),
    ]);
    if (!restaurant) {
      res.status(404).json({ error: "Restaurant introuvable" });
      return;
    }
    if (!zone) {
      res.status(400).json({ error: "Zone de livraison inconnue" });
      return;
    }

    const menuItems = await prisma.menuItem.findMany({
      where: {
        restaurantId: restaurant.id,
        available: true,
        id: { in: input.items.map((i) => i.menuItemId) },
      },
      select: { id: true, name: true, price: true },
    });

    let priced;
    try {
      priced = priceOrder(input.items, menuItems, zone.deliveryFee);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }

    const createOrder = (code: string) => prisma.order.create({
      data: {
        code,
        restaurantId: restaurant.id,
        zoneId: zone.id,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        address: input.address,
        note: input.note || null,
        paymentMethod: input.paymentMethod,
        subtotal: priced.subtotal,
        deliveryFee: priced.deliveryFee,
        total: priced.total,
        items: { create: priced.lines },
      },
    });

    // Le code court peut rarement entrer en collision : on réessaie.
    let order;
    for (let attempt = 0; ; attempt++) {
      try {
        order = await createOrder(orderCode());
        break;
      } catch (e) {
        if (attempt < 4 && (e as { code?: string }).code === "P2002") continue;
        throw e;
      }
    }

    const message = whatsappMessage({
      ...order,
      restaurantName: restaurant.name,
      zoneName: zone.name,
      items: priced.lines,
    });

    res.status(201).json({
      code: order.code,
      total: order.total,
      whatsappUrl: whatsappUrl(config.zedekaWhatsapp, message),
    });
  });

  app.get("/api/orders/:code", async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { code: req.params.code },
      select: {
        code: true,
        status: true,
        subtotal: true,
        deliveryFee: true,
        total: true,
        paymentMethod: true,
        createdAt: true,
        restaurant: { select: { name: true } },
        zone: { select: { name: true } },
        items: { select: { name: true, unitPrice: true, quantity: true } },
      },
    });
    if (!order) {
      res.status(404).json({ error: "Commande introuvable" });
      return;
    }
    res.json(order);
  });

  app.use("/api", vendorApplicationsRouter(prisma, { uploadDir: config.uploadDir ?? "uploads" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
  });

  return app;
}
