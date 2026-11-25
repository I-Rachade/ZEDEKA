// Réservation de créneau : colis à retrait programmé (pickupAt), accepté à l'avance par un livreur.
//
// 1. À partir de 2 h avant l'heure (réglage slotOfferLeadMinutes), l'attribution automatique propose le colis au
//    livreur libre le plus proche, qui a 3 min pour accepter (slotOfferSeconds) au lieu de 60 s.
// 2. Accepté, il reste libre : la course ne le rend « occupé » qu'à partir de 45 min avant l'heure.
// 3. 45 min avant : rappel avec « Je confirme » (acceptée à moins de 45 min, elle vaut confirmation).
// 4. 30 min avant : confirmée et livreur en ligne, la course devient sa course en cours (« C'est l'heure ») ; sinon
//    elle lui est retirée et repart dans la répartition normale, l'équipe est prévenue.
// 5. Désistement libre jusqu'à 1 h avant ; ensuite, « Un problème ? » et l'équipe.
// Les colis sans heure de retrait et les repas ne passent jamais par ici.
import type { PrismaClient } from "@prisma/client";
import type { Notifier } from "./notify.js";
import { OPEN } from "./orderFlow.js";
import { ASSIGNMENT_TIMEOUT_MS } from "./driver.js";

// La course devient la course en cours du livreur (et la répartition normale prend le relais) 30 min avant.
export const PICKUP_LEAD_MS = 30 * 60_000;
// Rappel et confirmation ; à partir de là, plus de nouvelle course proposée au livreur réservé.
export const SLOT_CONFIRM_MS = 45 * 60_000;
// Désistement libre jusqu'à 1 h avant l'heure.
export const SLOT_RELEASE_MS = 60 * 60_000;
// Pas deux retraits réservés à moins d'1 h d'écart (comme les courses Zed).
export const SLOT_GAP_MS = 60 * 60_000;
export const DEFAULT_SLOT_OFFER_SECONDS = 180;

type Pickup = Date | null | undefined;

// Proposition (ou affectation) faite à l'avance, plus de 30 min avant l'heure de retrait : c'est une réservation.
export const isSlotOffer = (pickupAt: Pickup, at: Date) => !!pickupAt && pickupAt.getTime() - at.getTime() > PICKUP_LEAD_MS;

// Délai pour répondre à une proposition : 3 min pour une réservation, 60 s sinon.
export const offerTimeoutMs = (pickupAt: Pickup, createdAt: Date, slotSeconds = DEFAULT_SLOT_OFFER_SECONDS) =>
  isSlotOffer(pickupAt, createdAt) ? slotSeconds * 1000 : ASSIGNMENT_TIMEOUT_MS;

// Course qui occupe le livreur : en cours, sans heure de retrait ou avec un retrait dans moins de 45 min.
// (OR explicite sur null : en SQL, une comparaison sur un champ vide ne vaut ni vrai ni faux.)
export const busyOrderWhere = (now: Date) => ({
  status: { in: OPEN },
  handedOverAt: null,
  OR: [{ pickupAt: null }, { pickupAt: { lte: new Date(now.getTime() + SLOT_CONFIRM_MS) } }, { status: "PICKED_UP" as const }],
});

// Créneau trop proche d'un retrait déjà réservé par ce livreur ?
export const slotClash = (reserved: (Date | null)[], pickupAt: Date) =>
  reserved.some((r) => r && Math.abs(r.getTime() - pickupAt.getTime()) < SLOT_GAP_MS);

// Heure de Lomé (UTC+0, sans heure d'été).
export const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

export const firstName = (name: string) => name.split(" ")[0];

// Réservation acceptée : le client (s'il a un compte) sait qui viendra et à quelle heure.
export async function onSlotReserved(prisma: PrismaClient, notifier: Notifier, orderId: string, driverId: string, now = new Date()) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, code: true, customerId: true, pickupAt: true } });
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true } });
  if (!order?.pickupAt || !driver) return;
  // Acceptée à moins de 45 min de l'heure : pas de rappel à attendre, l'acceptation vaut confirmation.
  if (order.pickupAt.getTime() - now.getTime() <= SLOT_CONFIRM_MS) {
    await prisma.order.updateMany({ where: { id: orderId, driverId }, data: { slotReminderAt: now, slotConfirmedAt: now } });
  }
  if (order.customerId) {
    void notifier
      .push("customer", order.customerId, {
        title: `Colis ${order.code} : livreur réservé`,
        body: `${firstName(driver.name)} viendra chercher votre colis à ${hhmm(order.pickupAt)}.`,
        url: `/commande/${order.code}`,
        tag: `suivi-${order.id}`,
      })
      .catch(() => {});
  }
}

// Retire la réservation au livreur : la course redevient libre (répartition) et ses étapes de créneau sont effacées.
export async function dropReservation(prisma: PrismaClient, orderId: string, driverId: string, reason: string, now = new Date()) {
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, driverId, status: { in: OPEN } },
    data: { driverId: null, slotReminderAt: null, slotConfirmedAt: null, slotStartedAt: null },
  });
  if (!count) return false;
  await prisma.driverAssignment.updateMany({ where: { orderId, driverId, status: { in: ["SENT", "ACCEPTED"] } }, data: { status: "WITHDRAWN", reason, respondedAt: now } });
  return true;
}

async function tellCustomerSearching(notifier: Notifier, o: { id: string; code: string; customerId: string | null; pickupAt: Date | null }) {
  if (!o.customerId || !o.pickupAt) return;
  void notifier
    .push("customer", o.customerId, {
      title: `Colis ${o.code}`,
      body: `Votre retrait de ${hhmm(o.pickupAt)} reste programmé : nous cherchons un autre livreur.`,
      url: `/commande/${o.code}`,
      tag: `suivi-${o.id}`,
    })
    .catch(() => {});
}

// Désistement du livreur, jusqu'à 1 h avant l'heure.
export async function releaseSlot(prisma: PrismaClient, notifier: Notifier, orderId: string, driverId: string, now = new Date()): Promise<"OK" | "TOO_LATE" | "NOT_FOUND"> {
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, code: true, customerId: true, pickupAt: true, driverId: true, status: true, driver: { select: { name: true } } } });
  if (!o || o.driverId !== driverId || !o.pickupAt || o.status === "PICKED_UP") return "NOT_FOUND";
  if (o.pickupAt.getTime() - now.getTime() <= SLOT_RELEASE_MS) return "TOO_LATE";
  if (!(await dropReservation(prisma, orderId, driverId, "Désistement du livreur", now))) return "NOT_FOUND";
  await tellCustomerSearching(notifier, o);
  void notifier
    .staff("DRIVERS", { title: `Désistement : ${o.code}`, body: `${o.driver?.name ?? "Le livreur"} ne fera pas le retrait de ${hhmm(o.pickupAt)}. La course repart dans la répartition.`, url: "/admin/dispatch", tag: `assign-${o.id}` })
    .catch(() => {});
  return "OK";
}

// Confirmation du livreur (« Je confirme ») : possible dès l'acceptation, attendue au rappel.
export async function confirmSlot(prisma: PrismaClient, orderId: string, driverId: string, now = new Date()) {
  const { count } = await prisma.order.updateMany({ where: { id: orderId, driverId, status: { in: OPEN }, pickupAt: { not: null } }, data: { slotConfirmedAt: now } });
  return count > 0;
}

type Reserved = {
  id: string;
  code: string;
  customerId: string | null;
  pickupAt: Date | null;
  driverId: string | null;
  slotConfirmedAt: Date | null;
  driver: { name: string; online: boolean } | null;
  assignments: { driverId: string; createdAt: Date }[];
};

// La course est-elle une réservation du livreur actuel (acceptée plus de 30 min avant l'heure) ?
export const isReservation = (o: Pick<Reserved, "pickupAt" | "driverId" | "assignments">) =>
  o.assignments.some((a) => a.driverId === o.driverId && isSlotOffer(o.pickupAt, a.createdAt));

// Tâche de chaque minute : rappels 45 min avant, puis début du créneau (ou retrait) 30 min avant.
export async function runScheduledPickups(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const select = {
    id: true,
    code: true,
    customerId: true,
    pickupAt: true,
    driverId: true,
    slotConfirmedAt: true,
    driver: { select: { name: true, online: true } },
    assignments: { where: { status: "ACCEPTED" as const }, select: { driverId: true, createdAt: true } },
  };
  const at = (ms: number) => new Date(now.getTime() + ms);

  // 1. Rappel 45 min avant.
  const toRemind: Reserved[] = await prisma.order.findMany({
    where: { status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] }, driverId: { not: null }, slotReminderAt: null, slotConfirmedAt: null, pickupAt: { gt: at(PICKUP_LEAD_MS), lte: at(SLOT_CONFIRM_MS) } },
    select,
    take: 100,
  });
  let reminded = 0;
  for (const o of toRemind) {
    if (!isReservation(o)) continue;
    const { count } = await prisma.order.updateMany({ where: { id: o.id, driverId: o.driverId, slotReminderAt: null }, data: { slotReminderAt: now } });
    if (!count) continue;
    reminded++;
    void notifier
      .push("driver", o.driverId!, {
        title: `Rappel : retrait ${o.code} à ${hhmm(o.pickupAt!)}`,
        body: "Confirmez que vous y allez. Sans confirmation 30 min avant, la course passe à un autre livreur.",
        url: "/livreur",
        tag: `slot-${o.id}`,
        alarm: true,
      })
      .catch(() => {});
  }

  // 2. 30 min avant : la course démarre pour le livreur réservé, ou lui est retirée.
  const due: Reserved[] = await prisma.order.findMany({
    // Colis déjà récupéré en avance : plus rien à démarrer.
    where: { status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] }, driverId: { not: null }, slotStartedAt: null, pickupAt: { gt: new Date(now.getTime() - 6 * 60 * 60_000), lte: at(PICKUP_LEAD_MS) } },
    select,
    take: 100,
  });
  let started = 0;
  let dropped = 0;
  for (const o of due) {
    // Course attribuée dans les 30 dernières minutes (répartition normale) : rien à faire, on ne la revoit plus.
    if (!isReservation(o)) {
      if (o.assignments.some((a) => a.driverId === o.driverId)) await prisma.order.updateMany({ where: { id: o.id, slotStartedAt: null }, data: { slotStartedAt: now } });
      continue;
    }
    const time = hhmm(o.pickupAt!);
    if (o.slotConfirmedAt && o.driver?.online) {
      const { count } = await prisma.order.updateMany({ where: { id: o.id, driverId: o.driverId, slotStartedAt: null }, data: { slotStartedAt: now } });
      if (!count) continue;
      started++;
      void notifier
        .push("driver", o.driverId!, { title: `C'est l'heure : retrait ${o.code} à ${time}`, body: "Partez chercher le colis. La course est dans « Course en cours ».", url: "/livreur", tag: `slot-${o.id}`, alarm: true })
        .catch(() => {});
      continue;
    }
    const reason = o.slotConfirmedAt ? "Hors ligne à l'heure du retrait" : "Pas de confirmation 30 min avant";
    if (!(await dropReservation(prisma, o.id, o.driverId!, reason, now))) continue;
    dropped++;
    void notifier
      .push("driver", o.driverId!, { title: `Retrait ${o.code} retiré`, body: `${reason} : la course de ${time} passe à un autre livreur.`, url: "/livreur", tag: `slot-${o.id}` })
      .catch(() => {});
    void notifier
      .staff("DRIVERS", { title: `Créneau non tenu : ${o.code}`, body: `${o.driver?.name ?? "Le livreur"} : ${reason.toLowerCase()}. Retrait à ${time}, la course repart dans la répartition.`, url: "/admin/dispatch", tag: `assign-${o.id}`, alarm: true })
      .catch(() => {});
    await tellCustomerSearching(notifier, o);
  }
  return { reminded, started, dropped };
}
