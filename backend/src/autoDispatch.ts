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

export const AUTO_DISPATCH_NAME = "Attribution automatique";
// Position du livreur plus ancienne : on ne s'y fie plus pour la distance.
const FRESH_POSITION_MS = 15 * 60_000;
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
  const settings = await prisma.settings.findUnique({ where: { id: 1 }, select: { autoDispatchEnabled: true, autoDispatchMaxTries: true } });
  if (!settings?.autoDispatchEnabled) return 0;

  const orders = await prisma.order.findMany({
    // Même liste que « À répartir » dans l'admin : repas prêts, colis dès la demande, zone connue, position reçue.
    where: {
      status: { in: OPEN },
      driverId: null,
      fulfillment: "DELIVERY",
      zoneId: { not: PARCEL_ZONE_ID },
      OR: [{ type: "PARCEL" }, { status: { in: ["READY", "PICKED_UP"] } }],
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
      restaurant: { select: { latitude: true, longitude: true } },
      assignments: { select: { driverId: true, assignedBy: true } },
    },
  });
  if (!orders.length) return 0;

  // Livreurs libres : en ligne, sans course en cours ni proposition en attente.
  let free = await prisma.driver.findMany({
    where: {
      active: true,
      status: "APPROVED",
      online: true,
      deletedAt: null,
      orders: { none: { status: { in: OPEN } } },
      assignments: { none: { status: "SENT" } },
    },
    select: { id: true, zoneId: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true },
  });

  let sent = 0;
  for (const order of orders) {
    if (!free.length) break;
    const tries = order.assignments.filter((a) => a.assignedBy === AUTO_DISPATCH_NAME).length;
    if (tries >= settings.autoDispatchMaxTries) continue;
    // Un livreur qui a déjà eu cette course (refus, silence, retrait) n'est pas relancé.
    const already = new Set(order.assignments.map((a) => a.driverId));
    const r = order.restaurant;
    const pickup: Point | null =
      r?.latitude != null && r.longitude != null
        ? { latitude: r.latitude, longitude: r.longitude }
        : order.pickupLatitude != null && order.pickupLongitude != null
          ? { latitude: order.pickupLatitude, longitude: order.pickupLongitude }
          : order.latitude != null && order.longitude != null
            ? { latitude: order.latitude, longitude: order.longitude }
            : null;
    const driver = pickDriver(free.filter((d) => !already.has(d.id)), pickup, order.zoneId, now);
    if (!driver) continue;
    // Prise de la commande seulement si personne ne l'a attribuée entre-temps.
    const { count } = await prisma.order.updateMany({ where: { id: order.id, driverId: null, status: { in: OPEN } }, data: { driverId: driver.id } });
    if (!count) continue;
    await assignDriver(prisma, notifier, { id: order.id, code: order.code, driverId: null }, driver.id, AUTO_DISPATCH_NAME);
    free = free.filter((d) => d.id !== driver.id);
    sent++;
  }
  return sent;
}
