import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { addressWithLandmark, firstName, hashLocationToken, isTokenShape, issueLocationLink, linkUsable, locationLink } from "../locationRequest.js";
import type { Notifier } from "../notify.js";
import { normalizeCode } from "../pricing.js";
import { firstError } from "../util.js";
import { linkedCustomerId } from "./customer.js";

type Config = { secret: string; notifier: Notifier; frontendOrigin: string };

// Même réponse pour un lien inconnu, échu ou remplacé : on ne révèle pas ce qui existe.
const GONE = "Ce lien n'est plus valable. Contactez la personne qui vous envoie le colis.";

const landmark = z.string().trim().max(200).optional();
const shareInput = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).optional(),
  landmark,
  consent: z.literal(true, { errorMap: () => ({ message: "Votre accord est nécessaire" }) }),
});

export function positionRouter(prisma: PrismaClient, config: Config) {
  const router = Router();

  router.use("/position", (_req, res, next) => {
    res.set({ "X-Robots-Tag": "noindex", "Cache-Control": "no-store" });
    next();
  });

  async function findRequest(token: string) {
    if (!isTokenShape(token)) return null;
    const request = await prisma.locationRequest.findUnique({
      where: { tokenHash: hashLocationToken(token) },
      include: { order: { select: { id: true, code: true, status: true, customerName: true, address: true, driverId: true } } },
    });
    return request && linkUsable(request, request.order.status, new Date()) ? request : null;
  }

  // Page du destinataire : seulement le prénom de l'expéditeur et l'état du lien.
  router.get("/position/:token", async (req, res) => {
    const request = await findRequest(req.params.token);
    if (!request) {
      res.status(404).json({ error: GONE });
      return;
    }
    if (request.status === "PENDING") await prisma.locationRequest.update({ where: { id: request.id }, data: { status: "OPENED", openedAt: new Date() } });
    res.json({ senderFirstName: firstName(request.order.customerName), status: request.status === "PENDING" ? "OPENED" : request.status, expiresAt: request.expiresAt });
  });

  router.post("/position/:token", async (req, res) => {
    const parsed = shareInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const request = await findRequest(req.params.token);
    if (!request) {
      res.status(404).json({ error: GONE });
      return;
    }
    const input = parsed.data;
    const now = new Date();
    await prisma.$transaction([
      prisma.order.update({
        where: { id: request.order.id },
        data: { latitude: input.latitude, longitude: input.longitude, locationSource: "RECIPIENT", address: addressWithLandmark(request.order.address, input.landmark) },
      }),
      prisma.locationRequest.update({
        where: { id: request.id },
        data: { status: "SHARED", consentAt: now, respondedAt: now, accuracyM: input.accuracy ?? null, landmark: input.landmark || null },
      }),
    ]);
    const body = input.accuracy ? `Position reçue, précise à ${Math.round(input.accuracy)} m près` : "Position reçue";
    void config.notifier.push("admin", "admin", { title: `Colis ${request.order.code} : position du destinataire`, body, url: `/admin/commandes/${request.order.id}`, tag: `position-${request.order.id}` });
    if (request.order.driverId) void config.notifier.push("driver", request.order.driverId, { title: `Colis ${request.order.code}`, body: `${body}. Le point de livraison est à jour.`, url: `/livreur/course/${request.order.id}`, tag: `position-${request.order.id}` });
    res.json({ ok: true });
  });

  router.post("/position/:token/decline", async (req, res) => {
    const parsed = z.object({ landmark }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const request = await findRequest(req.params.token);
    if (!request) {
      res.status(404).json({ error: GONE });
      return;
    }
    // Une position déjà envoyée reste valable : le refus ne l'efface pas.
    const lm = parsed.data.landmark || undefined;
    await prisma.$transaction([
      prisma.order.update({ where: { id: request.order.id }, data: { address: addressWithLandmark(request.order.address, lm) } }),
      prisma.locationRequest.update({
        where: { id: request.id },
        data: { status: request.status === "SHARED" ? "SHARED" : "DECLINED", respondedAt: new Date(), ...(lm ? { landmark: lm } : {}) },
      }),
    ]);
    res.json({ ok: true });
  });

  // Nouveau lien depuis le suivi : le compte qui a passé la commande, ou le code et le numéro de l'expéditeur.
  router.post("/parcels/:code/location-link", async (req, res) => {
    const parsed = z.object({ phone: z.string().trim().max(20).optional() }).safeParse(req.body ?? {});
    const order = await prisma.order.findUnique({
      where: { code: normalizeCode(req.params.code) },
      select: { id: true, type: true, status: true, customerId: true, customerName: true, customerPhone: true, recipientName: true, recipientPhone: true },
    });
    const tail = (p: string) => p.replace(/\D/g, "").slice(-8);
    const phone = parsed.success ? (parsed.data.phone ?? "") : "";
    const customerId = await linkedCustomerId(prisma, req, config.secret);
    const allowed = order && ((customerId && order.customerId === customerId) || (tail(phone).length === 8 && tail(phone) === tail(order.customerPhone)));
    if (!order || !allowed || order.type !== "PARCEL") {
      res.status(404).json({ error: "Aucun colis ne correspond à ce code et ce numéro" });
      return;
    }
    if (["PICKED_UP", "DELIVERED", "CANCELLED"].includes(order.status)) {
      res.status(409).json({ error: "Le colis est déjà en route : la position ne peut plus être demandée." });
      return;
    }
    const { token, expiresAt } = await issueLocationLink(prisma, order.id, new Date());
    res.status(201).json(locationLink(config.frontendOrigin, token, order, expiresAt));
  });

  return router;
}
