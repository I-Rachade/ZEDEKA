import { type Request, type Response, Router } from "express";
import type { Order, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier, PushPayload } from "./notify.js";
import { OPEN } from "./orderFlow.js";
import { normalizeCode } from "./pricing.js";
import { RECEIPT_KEY_HEADER, receiptAllowed } from "./receipt.js";
import { linkedCustomerId } from "./routes/customer.js";
import { firstError } from "./util.js";

// Messagerie écrite entre le client et le livreur d'une commande (repas, colis, vente d'une boutique).
// - Ouverte dès qu'un livreur a accepté la course, fermée (lecture seule) à la livraison ou à l'annulation.
// - Chaque message garde le livreur de la conversation : si la course passe à un autre livreur, il ne voit pas
//   ce qui a été écrit avant lui, le client voit tout.
// - Les messages restent archivés avec la commande ; l'équipe les lit dans le détail de la commande (admin).
// - Client : son compte, ou l'appareil qui a commandé sans compte (même règle que la clôture de la livraison).

export type Sender = "CUSTOMER" | "DRIVER";

export const MESSAGE_MAX = 500;
// Freine l'envoi en rafale (un message par seconde en moyenne au plus), par personne et par commande.
export const BURST_LIMIT = 12;
const BURST_MS = 60_000;

// Réponses rapides : un livreur à moto tape peu, le client répond d'un geste.
export const QUICK_REPLIES: Record<Sender, string[]> = {
  DRIVER: ["Je suis en route.", "Je suis arrivé.", "J'arrive dans 5 minutes.", "Je ne trouve pas l'adresse, pouvez-vous me guider ?", "Pouvez-vous descendre, s'il vous plaît ?"],
  CUSTOMER: ["D'accord, merci !", "Je descends.", "Appelez-moi en arrivant.", "Je suis devant le portail.", "Laissez-le à l'accueil, s'il vous plaît."],
};

type ChatOrder = Pick<Order, "status" | "driverId">;

// Conversation ouverte : le livreur a accepté la course (une simple proposition ne suffit pas) et elle n'est ni
// livrée ni annulée.
export function chatOpen(o: ChatOrder, accepted: boolean): boolean {
  return !!o.driverId && accepted && OPEN.includes(o.status);
}

// Le livreur de la commande a-t-il accepté la course ? (order.driverId est posé dès la proposition.)
export async function driverAccepted(prisma: PrismaClient, o: Pick<Order, "id" | "driverId">): Promise<boolean> {
  if (!o.driverId) return false;
  return (await prisma.driverAssignment.count({ where: { orderId: o.id, driverId: o.driverId, status: "ACCEPTED" } })) > 0;
}

export const messageInput = z.object({
  body: z
    .string({ required_error: "Écrivez un message" })
    .transform((v) => v.replace(/\s+\n/g, "\n").trim())
    .pipe(z.string().min(1, "Écrivez un message").max(MESSAGE_MAX, `Message trop long (${MESSAGE_MAX} caractères au plus)`)),
});

const preview = (body: string) => (body.length > 120 ? `${body.slice(0, 117)}…` : body);

// Notification du nouveau message pour l'autre personne (le client n'en reçoit que s'il a un compte).
export function chatNotice(o: Pick<Order, "id" | "code">, from: Sender, body: string, driverFirstName: string | null): PushPayload {
  if (from === "CUSTOMER") return { title: `Message du client · ${o.code}`, body: preview(body), url: `/livreur/course/${o.id}?chat=1`, tag: `chat-${o.id}` };
  return { title: `${driverFirstName ?? "Votre livreur"} vous écrit · ${o.code}`, body: preview(body), url: `/commande/${o.code}?chat=1`, tag: `chat-${o.id}` };
}

const messageSelect = { id: true, sender: true, body: true, readAt: true, createdAt: true } as const;
type MessageRow = { id: string; sender: string; body: string; readAt: Date | null; createdAt: Date };

// Fil vu par une personne : ses messages à droite (mine), lus ou non par l'autre.
function shape(rows: MessageRow[], viewer: Sender) {
  return rows.map((m) => ({ id: m.id, from: m.sender, mine: m.sender === viewer, body: m.body, at: m.createdAt, read: !!m.readAt }));
}

// Lit le fil et marque comme lus les messages de l'autre personne.
// peek : fil fermé (badge de la page de suivi ou de la course), rien n'est marqué comme lu.
export async function readThread(prisma: PrismaClient, orderId: string, viewer: Sender, driverId: string | null, peek = false) {
  const where = { orderId, ...(viewer === "DRIVER" ? { driverId } : {}) };
  const rows = await prisma.chatMessage.findMany({ where, orderBy: { createdAt: "asc" }, take: 500, select: messageSelect });
  const unread = rows.filter((m) => m.sender !== viewer && !m.readAt);
  if (peek) return { messages: shape(rows, viewer), unread: unread.length };
  if (unread.length) {
    const now = new Date();
    await prisma.chatMessage.updateMany({ where: { id: { in: unread.map((m) => m.id) } }, data: { readAt: now } });
    // Le lecteur voit ses propres messages tels quels ; ceux qu'il vient de lire ne comptent plus comme nouveaux.
    for (const m of unread) m.readAt = now;
  }
  return { messages: shape(rows, viewer), unread: 0 };
}

export class ChatError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Envoi d'un message : conversation ouverte, pas de rafale, puis notification à l'autre personne.
export async function sendMessage(
  prisma: PrismaClient,
  notifier: Notifier,
  order: Pick<Order, "id" | "code" | "status" | "driverId" | "customerId">,
  from: Sender,
  body: string,
  now = new Date(),
) {
  if (!chatOpen(order, await driverAccepted(prisma, order)))
    throw new ChatError(409, OPEN.includes(order.status) ? "La conversation s'ouvre dès qu'un livreur a accepté la course" : "Livraison terminée : la conversation est archivée");
  const recent = await prisma.chatMessage.count({ where: { orderId: order.id, sender: from, createdAt: { gte: new Date(now.getTime() - BURST_MS) } } });
  if (recent >= BURST_LIMIT) throw new ChatError(429, "Trop de messages d'un coup, patientez un instant");
  const message = await prisma.chatMessage.create({ data: { orderId: order.id, sender: from, driverId: order.driverId, body }, select: messageSelect });
  if (from === "CUSTOMER") {
    void notifier.push("driver", order.driverId!, chatNotice(order, from, body, null)).catch(() => {});
  } else if (order.customerId) {
    const driver = await prisma.driver.findUnique({ where: { id: order.driverId! }, select: { name: true } }).catch(() => null);
    void notifier.push("customer", order.customerId, chatNotice(order, from, body, driver?.name.split(" ")[0] ?? null)).catch(() => {});
  }
  return shape([message], from)[0];
}

function sendChatError(res: Response, e: unknown) {
  if (e instanceof ChatError) res.status(e.status).json({ error: e.message });
  else throw e;
}

// Côté client, depuis la page de suivi : /api/chat/:code. Même accès que la clôture (compte ou appareil qui a commandé).
// Une commande introuvable et une commande d'un autre répondent pareil : le code seul ne révèle rien.
export function customerChatRouter(prisma: PrismaClient, config: { secret: string; notifier: Notifier }) {
  const router = Router();

  async function orderFor(req: Request) {
    const order = await prisma.order.findUnique({
      where: { code: normalizeCode(String(req.params.code)) },
      select: { id: true, code: true, status: true, driverId: true, customerId: true, receiptKeyHash: true, fulfillment: true, tableNumber: true, driver: { select: { name: true } } },
    });
    if (!order) throw new ChatError(404, "Conversation introuvable");
    const customerId = order.customerId ? await linkedCustomerId(prisma, req, config.secret) : null;
    if (!receiptAllowed(order, customerId, req.get(RECEIPT_KEY_HEADER))) throw new ChatError(404, "Conversation introuvable");
    // Sur place ou à emporter : pas de livreur, pas de conversation.
    if (order.fulfillment === "PICKUP" || order.tableNumber != null) throw new ChatError(404, "Conversation introuvable");
    return order;
  }

  router.get("/chat/:code", async (req, res) => {
    try {
      const order = await orderFor(req);
      const accepted = await driverAccepted(prisma, order);
      const { messages, unread } = await readThread(prisma, order.id, "CUSTOMER", null, req.query.peek === "1");
      res.json({
        open: chatOpen(order, accepted),
        driverFirstName: accepted ? (order.driver?.name.split(" ")[0] ?? null) : null,
        messages,
        unread,
        quickReplies: QUICK_REPLIES.CUSTOMER,
      });
    } catch (e) {
      sendChatError(res, e);
    }
  });

  router.post("/chat/:code", async (req, res) => {
    const parsed = messageInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const order = await orderFor(req);
      res.json(await sendMessage(prisma, config.notifier, order, "CUSTOMER", parsed.data.body));
    } catch (e) {
      sendChatError(res, e);
    }
  });

  return router;
}

// Liste des conversations du client connecté (onglet « Messages » : en cours et archivées).
export async function customerConversations(prisma: PrismaClient, customerId: string) {
  const orders = await prisma.order.findMany({
    where: { customerId, OR: [{ status: { in: OPEN }, driverId: { not: null }, fulfillment: "DELIVERY", tableNumber: null }, { messages: { some: {} } }] },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      code: true,
      type: true,
      status: true,
      storeSale: true,
      createdAt: true,
      driverId: true,
      assignments: { where: { status: "ACCEPTED" }, select: { driverId: true } },
      restaurant: { select: { name: true } },
      merchant: { select: { shopName: true } },
      driver: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { sender: true, body: true, createdAt: true } },
      _count: { select: { messages: { where: { sender: "DRIVER", readAt: null } } } },
    },
  });
  return orders
    .map((o) => {
      const last = o.messages[0] ?? null;
      const accepted = o.assignments.some((a) => a.driverId === o.driverId);
      return {
        code: o.code,
        open: chatOpen(o, accepted),
        title: o.storeSale ? (o.merchant?.shopName ?? "Boutique") : o.type === "PARCEL" ? "Colis" : (o.restaurant?.name ?? "Repas"),
        driverFirstName: accepted || last ? (o.driver?.name.split(" ")[0] ?? null) : null,
        status: o.status,
        last: last ? { mine: last.sender === "CUSTOMER", body: preview(last.body), at: last.createdAt } : null,
        unread: o._count.messages,
        at: last?.createdAt ?? o.createdAt,
      };
    })
    // En cours : seulement les courses acceptées par un livreur (ou déjà écrites) ; une simple proposition n'ouvre rien.
    .filter((c) => c.open || c.last)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

// Côté livreur (/api/livreur/orders/:id/chat) : seulement le livreur de la course, sur sa propre conversation.
export function driverChatRoutes(router: Router, prisma: PrismaClient, notifier: Notifier) {
  async function orderFor(id: string, driverId: string) {
    const order = await prisma.order.findFirst({
      where: { id, assignments: { some: { driverId, status: "ACCEPTED" } } },
      select: { id: true, code: true, status: true, driverId: true, customerId: true, customerName: true },
    });
    if (!order) throw new ChatError(404, "Course introuvable");
    return order;
  }

  router.get("/orders/:id/chat", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const order = await orderFor(String(req.params.id), driverId);
      const mine = order.driverId === driverId;
      const { messages, unread } = await readThread(prisma, order.id, "DRIVER", driverId, req.query.peek === "1");
      res.json({
        open: mine && chatOpen(order, true),
        customerFirstName: order.customerName.split(" ")[0],
        // Commande sans compte client : il n'est pas prévenu par notification, seulement sur la page de suivi.
        customerNotified: !!order.customerId,
        messages,
        unread,
        quickReplies: QUICK_REPLIES.DRIVER,
      });
    } catch (e) {
      sendChatError(res, e);
    }
  });

  router.post("/orders/:id/chat", async (req, res) => {
    const parsed = messageInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const driverId: string = res.locals.driverId;
      const order = await orderFor(String(req.params.id), driverId);
      if (order.driverId !== driverId) throw new ChatError(409, "Cette course a été confiée à un autre livreur");
      res.json(await sendMessage(prisma, notifier, order, "DRIVER", parsed.data.body));
    } catch (e) {
      sendChatError(res, e);
    }
  });
}

// Admin : toute la conversation de la commande, sans la marquer comme lue.
export async function adminThread(prisma: PrismaClient, orderId: string) {
  const rows = await prisma.chatMessage.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: { id: true, sender: true, body: true, readAt: true, createdAt: true, driver: { select: { name: true } } },
  });
  return rows.map((m) => ({ id: m.id, from: m.sender, body: m.body, at: m.createdAt, readAt: m.readAt, driverName: m.driver?.name ?? null }));
}
