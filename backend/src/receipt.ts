import type { Order, PrismaClient } from "@prisma/client";
import { alertLowDeposit } from "./deposit.js";
import type { Notifier } from "./notify.js";
import { statusUpdate } from "./orderFlow.js";
import { HttpError } from "./routes/adminWrite.js";

// Clôture de la livraison par le client. Le livreur déclare la remise (handedOverAt) : la commande attend
// alors le client, qui confirme la réception et note le livreur (et le restaurant s'il le souhaite).
// Sur place, le client peut aussi donner son code à 4 chiffres au livreur, qui clôture aussitôt.
// Sans réponse du client, la livraison se clôture d'elle-même ; « Je n'ai rien reçu » prévient l'admin.

export const AUTO_CLOSE_MS = 30 * 60_000;
export const RATING_WINDOW_MS = 7 * 24 * 60 * 60_000; // délai pour noter après la livraison

export type ClosedBy = "CUSTOMER" | "CODE" | "AUTO" | "ADMIN" | "DRIVER";

export function newDeliveryCode(random: () => number = Math.random): string {
  return String(Math.floor(random() * 10_000)).padStart(4, "0");
}

export function codeMatches(expected: string | null, given: string | undefined): boolean {
  return !!expected && !!given && given.replace(/\D/g, "") === expected;
}

type Receipt = Pick<Order, "status" | "handedOverAt" | "receiptDisputedAt" | "deliveredAt" | "driverId" | "ratedAt" | "fulfillment">;

// Ce que le client peut faire depuis son suivi.
export function receiptState(o: Receipt, now = new Date()): "CONFIRM" | "DISPUTED" | "RATE" | null {
  if (o.status === "PICKED_UP" && o.handedOverAt) return o.receiptDisputedAt ? "DISPUTED" : "CONFIRM";
  if (o.status === "DELIVERED" && o.driverId && !o.ratedAt && o.deliveredAt && now.getTime() - o.deliveredAt.getTime() < RATING_WINDOW_MS) return "RATE";
  return null;
}

// Remises déclarées sans réponse du client après AUTO_CLOSE_MS, et non contestées.
export function dueForAutoClose(o: Pick<Order, "status" | "handedOverAt" | "receiptDisputedAt">, now = new Date()): boolean {
  return o.status === "PICKED_UP" && !!o.handedOverAt && !o.receiptDisputedAt && now.getTime() - o.handedOverAt.getTime() >= AUTO_CLOSE_MS;
}

// Passe la commande à « livrée » : part du livreur, paiement, heure de remise déclarée par le livreur.
export async function closeDelivery(prisma: PrismaClient, notifier: Notifier, current: Order, by: ClosedBy, now = new Date()) {
  const update = await statusUpdate(prisma, current, "DELIVERED");
  update.deliveredAt = current.handedOverAt ?? now;
  update.closedBy = by;
  if (!current.pickedUpAt) update.pickedUpAt = update.deliveredAt;
  // Course déjà clôturée entre-temps (autre appareil, boucle automatique) : rien à faire.
  const { count } = await prisma.order.updateMany({ where: { id: current.id, status: "PICKED_UP" }, data: update as never });
  if (!count) return false;
  if (update.paidFromDeposit && current.restaurantId) void alertLowDeposit(prisma, notifier, current.restaurantId);
  if (current.driverId && by !== "CODE") {
    await notifier.push("driver", current.driverId, {
      title: `Livraison clôturée : ${current.code}`,
      body: by === "CUSTOMER" ? "Le client a confirmé la réception." : "Clôturée sans réponse du client.",
      url: "/livreur",
      tag: `closed-${current.id}`,
    });
  }
  return true;
}

export async function autoCloseDeliveries(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const late = await prisma.order.findMany({
    where: { status: "PICKED_UP", handedOverAt: { lte: new Date(now.getTime() - AUTO_CLOSE_MS) }, receiptDisputedAt: null },
    take: 50,
  });
  let closed = 0;
  for (const o of late) if (dueForAutoClose(o, now) && (await closeDelivery(prisma, notifier, o, "AUTO", now))) closed++;
  return closed;
}

export type ReceiptInput =
  | { received: true; driverRating: number; restaurantRating?: number; comment?: string }
  | { received: false; note: string };

// Réponse du client depuis son suivi : confirmation et notes, notes seules après une clôture par code
// ou automatique, ou contestation.
export async function answerReceipt(prisma: PrismaClient, notifier: Notifier, current: Order, input: ReceiptInput, now = new Date()) {
  const state = receiptState(current, now);
  if (!input.received) {
    if (state !== "CONFIRM") throw new HttpError(409, state === "DISPUTED" ? "Votre signalement est déjà transmis" : "Le livreur n'a pas encore indiqué la remise");
    await prisma.order.update({ where: { id: current.id }, data: { receiptDisputedAt: now, receiptDisputeNote: input.note } });
    await notifier.staff("ORDERS", {
      title: `Commande non reçue : ${current.code}`,
      body: `Le client dit ne rien avoir reçu : ${input.note}`,
      url: `/admin/commandes/${current.id}`,
      tag: `dispute-${current.id}`,
      alarm: true,
    });
    return;
  }
  if (state !== "CONFIRM" && state !== "RATE") throw new HttpError(409, state === "DISPUTED" ? "Votre signalement est en cours de traitement par Zedeka" : "Rien à confirmer pour cette commande");
  const rating = {
    driverRating: input.driverRating,
    restaurantRating: current.type === "FOOD" && current.restaurantId ? (input.restaurantRating ?? null) : null,
    ratingComment: input.comment?.trim() || null,
    ratedAt: now,
  };
  if (state === "CONFIRM") await closeDelivery(prisma, notifier, current, "CUSTOMER", now);
  await prisma.order.update({ where: { id: current.id }, data: rating });
}
