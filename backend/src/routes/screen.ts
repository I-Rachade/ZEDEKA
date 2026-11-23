import { Router, type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { OPEN } from "../orderFlow.js";
import { availability } from "../openingHours.js";
import { issueLiveTicket } from "../live.js";
import { getSettings } from "../util.js";
import { staffName } from "../team.js";
import {
  buildSummary,
  dayStart,
  hashPairingToken,
  hashScreenKey,
  history,
  isPairingCode,
  isScreenKey,
  newPairingCode,
  newPairingToken,
  newScreenKey,
  PAIRING_TTL_MS,
  shortName,
} from "../screen.js";
import { techScreen } from "../techScreen.js";
import type { OnlineCounter } from "../techSamples.js";

export const SCREEN_KINDS = ["OFFICE", "TECH"] as const;
const kindSchema = z.enum(SCREEN_KINDS).default("OFFICE");

// Écran du bureau (src/screen.ts) : /api/screen/* en lecture seule pour l'écran, /api/admin/screens pour le directeur.

const DAY = 86_400_000;
// Livreur vu sur la carte : position de moins de 5 min (comme la Répartition) ; au-delà, gris.
const STALE_MS = 5 * 60_000;
// Signe de vie de l'écran : écrit au plus une fois toutes les 5 min.
const SEEN_EVERY_MS = 5 * 60_000;

const keyOf = (req: Request) => {
  const header = req.headers["x-screen-key"];
  return typeof header === "string" ? header.trim() : "";
};

export function screenRouter(prisma: PrismaClient, config: { secret: string; now?: () => Date; online?: OnlineCounter }) {
  const router = Router();
  const now = config.now ?? (() => new Date());

  // Appairage, avant la clé : un appareil sans clé demande un code à afficher, puis attend que le directeur le tape.
  router.post("/pair", async (req, res) => {
    const at = now();
    // Type demandé par la page : /ecran (bureau) ou /ecran-technique.
    const kind = kindSchema.catch("OFFICE").parse(req.body?.kind);
    await prisma.screenPairing.deleteMany({ where: { expiresAt: { lt: at } } });
    const token = newPairingToken();
    const expiresAt = new Date(at.getTime() + PAIRING_TTL_MS);
    // Code déjà pris par un autre écran en attente (rare) : on en tire un autre.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = newPairingCode();
      if (await prisma.screenPairing.findUnique({ where: { code }, select: { id: true } })) continue;
      await prisma.screenPairing.create({ data: { code, tokenHash: hashPairingToken(token), expiresAt, kind } });
      res.set("Cache-Control", "no-store");
      res.status(201).json({ code, token, expiresAt: expiresAt.toISOString() });
      return;
    }
    res.status(503).json({ error: "Réessayez dans un instant" });
  });

  // L'écran attend : « waiting » tant que le code n'a pas été tapé, puis sa clé, remise une seule fois.
  router.get("/pair", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const header = req.headers["x-pair-token"];
    const token = typeof header === "string" ? header.trim() : "";
    const pairing = token && token.length <= 64 ? await prisma.screenPairing.findUnique({ where: { tokenHash: hashPairingToken(token) } }) : null;
    if (!pairing || pairing.expiresAt.getTime() < now().getTime()) {
      res.status(410).json({ error: "Code expiré" });
      return;
    }
    if (!pairing.key) {
      res.json({ status: "waiting", code: pairing.code, expiresAt: pairing.expiresAt.toISOString() });
      return;
    }
    await prisma.screenPairing.delete({ where: { id: pairing.id } }).catch(() => {});
    const screen = pairing.screenId ? await prisma.displayScreen.findUnique({ where: { id: pairing.screenId }, select: { name: true } }) : null;
    res.json({ status: "paired", key: pairing.key, name: screen?.name ?? null, kind: pairing.kind });
  });

  // Clé de l'écran : un lien révoqué ou inconnu ne voit rien.
  router.use(async (req: Request, res: Response, next: NextFunction) => {
    const key = keyOf(req);
    const screen = isScreenKey(key) ? await prisma.displayScreen.findUnique({ where: { keyHash: hashScreenKey(key) }, select: { id: true, name: true, lastSeenAt: true, revokedAt: true, kind: true } }) : null;
    if (!screen || screen.revokedAt) {
      res.status(401).json({ error: "Écran non autorisé" });
      return;
    }
    const at = now();
    if (!screen.lastSeenAt || at.getTime() - screen.lastSeenAt.getTime() > SEEN_EVERY_MS) {
      await prisma.displayScreen.update({ where: { id: screen.id }, data: { lastSeenAt: at } }).catch(() => {});
    }
    res.set("Cache-Control", "no-store");
    res.locals.screen = screen;
    next();
  });

  router.get("/me", (_req, res) => {
    const screen = res.locals.screen as { name: string; kind: string };
    res.json({ name: screen.name, kind: screen.kind });
  });

  // Écran technique : réservé aux écrans branchés comme tels (une clé d'écran du bureau ne le voit pas).
  const techOnly = (_req: Request, res: Response, next: NextFunction) => {
    if ((res.locals.screen as { kind: string }).kind !== "TECH") {
      res.status(403).json({ error: "Cet écran est branché comme écran du bureau" });
      return;
    }
    next();
  };
  router.get("/tech", techOnly, async (_req, res) => {
    res.json(await techScreen(prisma, config.online, now()));
  });
  // Temps réel de l'écran technique : signal « tech » à chaque nouvelle erreur, « admin » à chaque commande.
  router.get("/tech/realtime", techOnly, (_req, res) => {
    res.json({ ticket: issueLiveTicket(config.secret, ["tech", "admin"]) });
  });

  // Ticket temps réel : le canal « admin » reçoit un signal (sans aucune donnée) à chaque commande qui change.
  router.get("/realtime", (_req, res) => {
    res.json({ ticket: issueLiveTicket(config.secret, ["admin"]) });
  });

  // Écran « compteur » : livraisons du jour, objectif, record, classement et fil des commandes.
  router.get("/summary", async (_req, res) => {
    const at = now();
    const start = dayStart(at);
    const yesterday = new Date(start.getTime() - DAY);
    const [orders, yesterdayCreated, yesterdayDeliveredSoFar, past, settings, zedRides] = await Promise.all([
      prisma.order.findMany({
        where: { OR: [{ createdAt: { gte: start } }, { deliveredAt: { gte: start } }, { status: { in: OPEN } }] },
        select: {
          code: true,
          type: true,
          status: true,
          storeSale: true,
          fulfillment: true,
          createdAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          driverId: true,
          restaurant: { select: { name: true, kind: true } },
          zone: { select: { name: true } },
        },
      }),
      prisma.order.findMany({ where: { createdAt: { gte: yesterday, lt: start } }, select: { createdAt: true } }),
      prisma.order.count({ where: { status: "DELIVERED", deliveredAt: { gte: yesterday, lte: new Date(at.getTime() - DAY) } } }),
      // Un an de livraisons, une seule colonne : record et moyenne des 7 derniers jours.
      prisma.order.findMany({ where: { status: "DELIVERED", deliveredAt: { gte: new Date(start.getTime() - 365 * DAY), lt: start } }, select: { deliveredAt: true } }),
      getSettings(prisma),
      prisma.zedRide.count({ where: { status: "COMPLETED", completedAt: { gte: start } } }),
    ]);
    const driverIds = [...new Set(orders.filter((o) => o.status === "DELIVERED" && o.driverId).map((o) => o.driverId!))];
    const drivers = driverIds.length ? await prisma.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, name: true } }) : [];
    res.json(
      buildSummary({
        now: at,
        orders,
        yesterdayCreated: yesterdayCreated.map((o) => o.createdAt),
        yesterdayDeliveredSoFar,
        past: history(
          past.map((o) => o.deliveredAt!).filter(Boolean),
          at,
        ),
        goalSetting: settings.screenDailyGoal ?? 0,
        drivers: new Map(drivers.map((d) => [d.id, d.name])),
        zedRides,
      }),
    );
  });

  // Écran « carte » : restaurants et boutiques, livreurs en ligne avec leur position, et les chiffres du terrain.
  // Pas de point de livraison (adresse d'un client) : seuls les commerces et les livreurs sont placés.
  router.get("/map", async (_req, res) => {
    const at = now();
    const ON_DUTY = { active: true, status: "APPROVED", deletedAt: null } as const;
    const [restaurants, drivers, openOrders, deliveredToday] = await Promise.all([
      prisma.restaurant.findMany({
        where: { active: true, deletedAt: null },
        select: { id: true, name: true, kind: true, latitude: true, longitude: true, active: true, temporarilyClosed: true, closedUntil: true, openingHours: true },
      }),
      prisma.driver.findMany({
        where: { ...ON_DUTY, OR: [{ online: true }, { orders: { some: { status: { in: OPEN } } } }] },
        select: { id: true, name: true, online: true, vehicle: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true },
      }),
      prisma.order.findMany({ where: { status: { in: OPEN } }, select: { status: true, driverId: true, restaurantId: true, type: true, fulfillment: true } }),
      prisma.order.count({ where: { status: "DELIVERED", deliveredAt: { gte: dayStart(at) } } }),
    ]);
    const busy = new Map<string, { restaurantId: string | null; phase: "PICKUP" | "DELIVERY" }>();
    for (const o of openOrders) {
      if (!o.driverId) continue;
      const phase = o.status === "PICKED_UP" ? "DELIVERY" : "PICKUP";
      // Une course vers un restaurant passe avant une livraison en cours : c'est elle que la carte relie.
      if (!busy.has(o.driverId) || phase === "PICKUP") busy.set(o.driverId, { restaurantId: o.restaurantId, phase });
    }
    const activePerRestaurant = new Map<string, number>();
    for (const o of openOrders) if (o.restaurantId) activePerRestaurant.set(o.restaurantId, (activePerRestaurant.get(o.restaurantId) ?? 0) + 1);

    const places = restaurants.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind === "SHOP" ? "SHOP" : "RESTAURANT",
      open: availability(r, at).open,
      activeOrders: activePerRestaurant.get(r.id) ?? 0,
      latitude: r.latitude,
      longitude: r.longitude,
    }));
    const riders = drivers.map((d) => {
      const job = busy.get(d.id);
      const fresh = d.lastLocationAt != null && at.getTime() - d.lastLocationAt.getTime() <= STALE_MS;
      return {
        id: d.id,
        name: shortName(d.name),
        vehicle: d.vehicle,
        state: job ? "BUSY" : !fresh ? "STALE" : "FREE",
        phase: job?.phase ?? null,
        restaurantId: job?.restaurantId ?? null,
        latitude: d.lastLatitude,
        longitude: d.lastLongitude,
        fresh,
      };
    });
    res.json({
      now: at.toISOString(),
      restaurants: places.filter((p) => p.latitude != null && p.longitude != null),
      drivers: riders.filter((d) => d.latitude != null && d.longitude != null),
      counts: {
        driversOnline: drivers.filter((d) => d.online).length,
        driversFree: riders.filter((d) => d.state === "FREE").length,
        driversBusy: riders.filter((d) => d.state === "BUSY").length,
        restaurantsOpen: places.filter((p) => p.open && p.kind === "RESTAURANT").length,
        shopsOpen: places.filter((p) => p.open && p.kind === "SHOP").length,
        restaurantsTotal: places.length,
        ordersInProgress: openOrders.length,
        toDispatch: openOrders.filter((o) => !o.driverId && o.fulfillment === "DELIVERY" && (o.type === "PARCEL" || o.status === "READY")).length,
        inKitchen: openOrders.filter((o) => o.status === "CONFIRMED" || o.status === "PREPARING").length,
        onTheRoad: openOrders.filter((o) => o.status === "PICKED_UP").length,
        deliveredToday,
      },
    });
  });

  return router;
}

const screenSelect = { id: true, name: true, keyHint: true, createdBy: true, createdAt: true, lastSeenAt: true, revokedAt: true, kind: true } as const;

// Gestion des écrans dans l'admin : liste, création (la clé n'est montrée qu'une fois), révocation, objectif du jour.
// Écriture réservée au directeur (team.ts : /screens dans DIRECTOR_WRITE_ONLY), lecture pour l'adjoint.
export function adminScreensRouter(prisma: PrismaClient, config: { frontendOrigin?: string }) {
  const router = Router();
  const linkOf = (key: string, kind: string) => `${(config.frontendOrigin ?? "").replace(/\/$/, "")}/${kind === "TECH" ? "ecran-technique" : "ecran"}?cle=${key}`;

  router.get("/screens", async (_req, res) => {
    const [screens, settings] = await Promise.all([prisma.displayScreen.findMany({ orderBy: { createdAt: "desc" }, select: screenSelect }), getSettings(prisma)]);
    res.json({ screens, goal: settings.screenDailyGoal ?? 0 });
  });

  router.post("/screens", async (req, res) => {
    const parsed = z.object({ name: z.string().trim().min(1).max(60), kind: kindSchema }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Donnez un nom à l'écran (60 caractères au plus)" });
      return;
    }
    const key = newScreenKey();
    const screen = await prisma.displayScreen.create({
      data: { name: parsed.data.name, kind: parsed.data.kind, keyHash: hashScreenKey(key), keyHint: key.slice(-4), createdBy: staffName(res) },
      select: screenSelect,
    });
    res.status(201).json({ screen, key, url: linkOf(key, parsed.data.kind) });
  });

  // Appairer : le directeur tape le code affiché par l'écran et lui donne un nom. L'écran reçoit sa clé à sa prochaine
  // lecture (3 s), sans que la clé passe par l'admin.
  router.post("/screens/pair", async (req, res) => {
    const parsed = z.object({ code: z.string().transform((c) => c.replace(/\s/g, "")), name: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!parsed.success || !isPairingCode(parsed.data.code)) {
      res.status(400).json({ error: "Tapez le code à 6 chiffres affiché sur l'écran, et donnez-lui un nom" });
      return;
    }
    const pairing = await prisma.screenPairing.findUnique({ where: { code: parsed.data.code } });
    if (!pairing || pairing.key || pairing.expiresAt.getTime() < Date.now()) {
      res.status(404).json({ error: "Code inconnu ou expiré : rechargez la page de l'écran pour en afficher un nouveau" });
      return;
    }
    const key = newScreenKey();
    const screen = await prisma.displayScreen.create({
      // Le type vient de la page qui a demandé le code (/ecran ou /ecran-technique).
      data: { name: parsed.data.name, kind: pairing.kind, keyHash: hashScreenKey(key), keyHint: key.slice(-4), createdBy: staffName(res) },
      select: screenSelect,
    });
    await prisma.screenPairing.update({ where: { id: pairing.id }, data: { key, screenId: screen.id } });
    res.status(201).json({ screen });
  });

  // Révoquer : l'écran affiche « lien révoqué » à sa prochaine lecture (30 s au plus).
  router.delete("/screens/:id", async (req, res) => {
    const found = await prisma.displayScreen.findUnique({ where: { id: String(req.params.id) }, select: { id: true, revokedAt: true } });
    if (!found) {
      res.status(404).json({ error: "Écran introuvable" });
      return;
    }
    if (!found.revokedAt) await prisma.displayScreen.update({ where: { id: found.id }, data: { revokedAt: new Date() } });
    res.json({ ok: true });
  });

  // Objectif de livraisons du jour (0 : automatique).
  router.put("/screens/goal", async (req, res) => {
    const parsed = z.object({ goal: z.number().int().min(0).max(100_000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Objectif invalide" });
      return;
    }
    await getSettings(prisma);
    await prisma.settings.update({ where: { id: 1 }, data: { screenDailyGoal: parsed.data.goal } });
    res.json({ goal: parsed.data.goal });
  });

  return router;
}
