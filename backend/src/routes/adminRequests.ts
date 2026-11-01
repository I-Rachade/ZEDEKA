import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";
import { staffName } from "../team.js";

// Demandes des clients, restaurants, boutiques et livreurs (appels, WhatsApp), saisies et traitées par l'équipe.
// File commune : n'importe quelle managerin peut prendre une demande, ajouter une note ou la clore.

export const REQUEST_SOURCES = ["CUSTOMER", "RESTAURANT", "DRIVER", "OTHER"] as const;
export const REQUEST_CHANNELS = ["WHATSAPP_CALL", "WHATSAPP_MESSAGE", "PHONE_CALL", "OTHER"] as const;
export const REQUEST_STATUSES = ["OPEN", "IN_PROGRESS", "DONE"] as const;

const requestInput = z.object({
  source: z.enum(REQUEST_SOURCES),
  channel: z.enum(REQUEST_CHANNELS),
  direction: z.enum(["IN", "OUT"]).default("IN"),
  subject: z.string().trim().min(3, "Objet : 3 caractères minimum").max(140),
  details: z.string().trim().max(2000).optional().nullable(),
  contactName: z.string().trim().max(80).optional().nullable(),
  contactPhone: z.string().trim().max(30).optional().nullable(),
  priority: z.enum(["NORMAL", "URGENT"]).default("NORMAL"),
  orderId: z.string().min(1).optional().nullable(),
  restaurantId: z.string().min(1).optional().nullable(),
  status: z.enum(REQUEST_STATUSES).default("OPEN"),
});

const requestPatch = z.object({
  status: z.enum(REQUEST_STATUSES),
  priority: z.enum(["NORMAL", "URGENT"]),
  subject: z.string().trim().min(3).max(140),
  details: z.string().trim().max(2000).nullable(),
  // true : « Je m'en occupe » ; false : remettre dans la file commune.
  take: z.boolean(),
});

const noteInput = z.object({ body: z.string().trim().min(1, "Note vide").max(2000) });

const include = {
  order: { select: { id: true, code: true, status: true, customerName: true, customerPhone: true } },
  restaurant: { select: { id: true, name: true, phone: true } },
  notes: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.SupportRequestInclude;

const who = (res: { locals: Record<string, unknown> }) => staffName(res) ?? "Direction";

export function adminRequestsRouter(prisma: PrismaClient) {
  const router = Router();

  // Filtres : statut (OPEN, IN_PROGRESS, DONE ou ACTIVE = pas clos), source, commande, restaurant, recherche.
  router.get("/requests", async (req, res) => {
    const where: Prisma.SupportRequestWhereInput = {};
    const status = String(req.query.status ?? "ACTIVE");
    if (status === "ACTIVE") where.status = { in: ["OPEN", "IN_PROGRESS"] };
    else if ((REQUEST_STATUSES as readonly string[]).includes(status)) where.status = status;
    const source = String(req.query.source ?? "");
    if ((REQUEST_SOURCES as readonly string[]).includes(source)) where.source = source;
    if (typeof req.query.orderId === "string" && req.query.orderId) where.orderId = req.query.orderId;
    if (typeof req.query.restaurantId === "string" && req.query.restaurantId) where.restaurantId = req.query.restaurantId;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q) {
      where.OR = [
        { subject: { contains: q } },
        { contactName: { contains: q } },
        { contactPhone: { contains: q } },
        { order: { code: { contains: q.toUpperCase() } } },
        { restaurant: { name: { contains: q } } },
      ];
    }
    res.json(
      await prisma.supportRequest.findMany({
        where,
        // Urgentes d'abord, puis les plus anciennes : personne n'attend trop longtemps.
        orderBy: status === "DONE" ? [{ closedAt: "desc" }] : [{ priority: "desc" }, { createdAt: "asc" }],
        take: 200,
        include,
      }),
    );
  });

  router.get("/requests/:id", async (req, res) => {
    const found = await prisma.supportRequest.findUnique({ where: { id: req.params.id }, include });
    if (!found) {
      res.status(404).json({ error: "Demande introuvable" });
      return;
    }
    res.json(found);
  });

  router.post(
    "/requests",
    write(requestInput, async (data, _id, res) => {
      if (data.orderId && !(await prisma.order.findUnique({ where: { id: data.orderId }, select: { id: true } }))) {
        throw new HttpError(400, "Commande introuvable");
      }
      if (data.restaurantId && !(await prisma.restaurant.findUnique({ where: { id: data.restaurantId }, select: { id: true } }))) {
        throw new HttpError(400, "Restaurant introuvable");
      }
      const me = who(res);
      return prisma.supportRequest.create({
        data: {
          ...data,
          createdBy: me,
          // Saisie pendant l'appel : celle qui la saisit s'en occupe, sauf si elle la laisse dans la file.
          assignedTo: data.status === "OPEN" ? null : me,
          closedAt: data.status === "DONE" ? new Date() : null,
        },
        include,
      });
    }),
  );

  router.patch(
    "/requests/:id",
    write(
      requestPatch,
      async ({ take, ...data }, id, res) => {
        const current = await prisma.supportRequest.findUnique({ where: { id } });
        if (!current) throw new HttpError(404, "Demande introuvable");
        const me = who(res);
        const update: Prisma.SupportRequestUpdateInput = { ...data };
        if (take === true) {
          update.assignedTo = me;
          if (!data.status && current.status === "OPEN") update.status = "IN_PROGRESS";
        } else if (take === false) {
          update.assignedTo = null;
          if (!data.status && current.status === "IN_PROGRESS") update.status = "OPEN";
        }
        const status = (update.status as string | undefined) ?? current.status;
        if (status !== current.status) {
          update.closedAt = status === "DONE" ? new Date() : null;
          if (status !== "OPEN" && !current.assignedTo && take !== false) update.assignedTo = me;
        }
        const saved = await prisma.supportRequest.update({ where: { id }, data: update, include });
        if (status !== current.status) {
          const label = { OPEN: "remise dans la file", IN_PROGRESS: "en cours", DONE: "close" }[status as (typeof REQUEST_STATUSES)[number]];
          await prisma.supportRequestNote.create({ data: { requestId: id, author: me, body: `Demande ${label}.` } });
          return prisma.supportRequest.findUnique({ where: { id }, include });
        }
        return saved;
      },
      { partial: true },
    ),
  );

  router.post(
    "/requests/:id/notes",
    write(noteInput, async ({ body }, id, res) => {
      if (!(await prisma.supportRequest.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, "Demande introuvable");
      await prisma.supportRequestNote.create({ data: { requestId: id, author: who(res), body } });
      await prisma.supportRequest.update({ where: { id }, data: { updatedAt: new Date() } });
      return prisma.supportRequest.findUnique({ where: { id }, include });
    }),
  );

  return router;
}
