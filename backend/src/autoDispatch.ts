// Attribution automatique des courses (Réglage « autoDispatchEnabled », désactivé par défaut).
// Chaque minute, les commandes à répartir sont proposées au livreur en ligne le plus proche du point de retrait.
// Refus ou silence de 60 s : la course revient et part au suivant. Après autoDispatchMaxTries propositions
// automatiques, la commande reste à l'équipe (managerin, dispatcheur), qui peut de toute façon réattribuer à la main.
import type { PrismaClient } from "@prisma/client";
import { distanceKm, PARCEL_ZONE_ID, type Point } from "./delivery.js";
import { AWAITING } from "./locationRequest.js";
import type { Notifier } from "./notify.js";
import { OPEN } from "./orderFlow.js";
import { assignDriver } from "./routes/driverApp.js";
import { busyOrderWhere, isSlotOffer, PICKUP_LEAD_MS, slotClash } from "./scheduledPickup.js";

export const AUTO_DISPATCH_NAME = "Attribution automatique";
// Position du livreur plus ancienne : on ne s'y fie plus pour la distance.
const FRESH_POSITION_MS = 15 * 60_000;
// Colis à retrait programmé : proposé en réservation à partir de slotOfferLeadMinutes (2 h) avant l'heure, puis,
// s'il n'a pas de livreur réservé, en course normale à partir de 30 minutes avant (src/scheduledPickup.ts).
export { PICKUP_LEAD_MS };
// Au-delà, un livreur n'est pas proposé, même s'il est le seul en ligne.
export const MAX_PICKUP_KM = 15;

export type Candidate = {
  id: string;
  zoneId: string | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastLocationAt: Date | null;
};

// Meilleur livreur pour un point de retrait : le plus proche s'il a une position récente, sinon un livreur de la
// même zone (ou sans zone) ; ceux sans position passent après ceux qui en ont une.
export function pickDriver(drivers: Candidate[], pickup: Point | null, zoneId: string, now = new Date()): Candidate | null {
  const ranked = drivers
    .map((d) => {
      const fresh = d.lastLatitude !== null && d.lastLongitude !== null && d.lastLocationAt && now.getTime() - d.lastLocationAt.getTime() < FRESH_POSITION_MS;
      const km = pickup && fresh ? distanceKm(pickup, { latitude: d.lastLatitude!, longitude: d.lastLongitude! }) : null;
      return { d, km };
    })
    .filter(({ d, km }) => (km !== null ? km <= MAX_PICKUP_KM : !d.zoneId || d.zoneId === zoneId))
    .sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity) || Number(a.d.zoneId !== zoneId) - Number(b.d.zoneId !== zoneId));
  return ranked[0]?.d ?? null;
}

export async function autoDispatch(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { autoDispatchEnabled: true, autoDispatchMaxTries: true, slotOfferLeadMinutes: true } });
  if (!settings?.autoDispatchEnabled) return 0;

  const orders = await prisma.order.findMany({
    // Même liste que « À répartir » dans l'admin : repas prêts, colis dès la demande, zone connue, position reçue.
    where: {
      status: { in: OPEN },
      driverId: null,
      fulfillment: "DELIVERY",
      zoneId: { not: PARCEL_ZONE_ID },
      AND: [
        { OR: [{ type: "PARCEL" }, { status: { in: ["READY", "PICKED_UP"] } }] },
        // Sans heure de retrait (cas de tous les repas) ou retrait dans moins de 2 h (réservation, puis course normale
        // à 30 min). Pas de NOT ici : en SQL, NOT (pickupAt > …) vaut NULL quand pickupAt est vide, et la commande
        // disparaissait de la répartition.
        { OR: [{ pickupAt: null }, { pickupAt: { lte: new Date(now.getTime() + Math.max(settings.slotOfferLeadMinutes * 60_000, PICKUP_LEAD_MS)) } }] },
        // Course réservée aux livreurs favoris du commerce (src/favorites.ts) : elle n'arrive ici qu'une fois en
        // demande ouverte. OR explicite sur null, comme pour pickupAt.
        { OR: [{ dispatchRoute: null }, { dispatchRoute: { not: "FAVORITE" } }] },
      ],
      NOT: { locationRequest: { status: { in: AWAITING } } },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      code: true,
      zoneId: true,
      latitude: true,
      longitude: true,
      pickupLatitude: true,
      pickupLongitude: true,
      pickupAt: true,
      restaurant: { select: { latitude: true, longitude: true } },
      assignments: { select: { driverId: true, assignedBy: true, createdAt: true } },
    },
  });
  if (!orders.length) return 0;

  // Livreurs libres : en ligne, sans course en cours ni proposition en attente. Un retrait réservé lointain (plus de
  // 45 min) ne compte pas : le livreur reste libre jusque-là.
  let free = await prisma.driver.findMany({
    where: {
      active: true,
      status: "APPROVED",
      online: true,
      deletedAt: null,
      deliveries: true,
      // Remise déclarée, en attente de la confirmation du client : le livreur est déjà libre.
      orders: { none: busyOrderWhere(now) },
      assignments: { none: { status: "SENT" } },
    },
    select: {
      id: true,
      zoneId: true,
      lastLatitude: true,
      lastLongitude: true,
      lastLocationAt: true,
      orders: { where: { status: { in: OPEN }, handedOverAt: null, pickupAt: { not: null } }, select: { pickupAt: true } },
    },
  });

  let sent = 0;
  for (const order of orders) {
    if (!free.length) break;
    // Deux temps pour un retrait programmé : la réservation (plus de 30 min avant), puis la course normale. Les essais
    // et les livreurs déjà sollicités se comptent séparément : la répartition normale reprend la main à 30 min même
    // si personne n'a réservé.
    const slot = isSlotOffer(order.pickupAt, now);
    const phase = order.assignments.filter((a) => isSlotOffer(order.pickupAt, a.createdAt) === slot);
    const tries = phase.filter((a) => a.assignedBy === AUTO_DISPATCH_NAME).length;
    if (tries >= settings.autoDispatchMaxTries) continue;
    // Un livreur qui a déjà eu cette course (refus, silence, retrait) n'est pas relancé.
    const already = new Set(phase.map((a) => a.driverId));
    const r = order.restaurant;
    const pickup: Point | null =
      r?.latitude != null && r.longitude != null
        ? { latitude: r.latitude, longitude: r.longitude }
        : order.pickupLatitude != null && order.pickupLongitude != null
          ? { latitude: order.pickupLatitude, longitude: order.pickupLongitude }
          : order.latitude != null && order.longitude != null
            ? { latitude: order.latitude, longitude: order.longitude }
            : null;
    // Réservation : pas deux retraits réservés à moins d'1 h d'écart pour le même livreur.
    const candidates = free.filter((d) => !already.has(d.id) && !(slot && slotClash(d.orders.map((o) => o.pickupAt), order.pickupAt!)));
    const driver = pickDriver(candidates, pickup, order.zoneId, now);
    if (!driver) continue;
    // Prise de la commande seulement si personne ne l'a attribuée entre-temps.
    const { count } = await prisma.order.updateMany({ where: { id: order.id, driverId: null, status: { in: OPEN } }, data: { driverId: driver.id } });
    if (!count) continue;
    await assignDriver(prisma, notifier, { id: order.id, code: order.code, driverId: null }, driver.id, AUTO_DISPATCH_NAME, now);
    free = free.filter((d) => d.id !== driver.id);
    sent++;
  }
  return sent;
}
