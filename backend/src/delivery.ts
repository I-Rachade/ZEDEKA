// Calculs de livraison : tarif de zone, distance, annulation, part du livreur.
import type { PrismaClient } from "@prisma/client";

export type ZonePricingInput = {
  pricing: "FIXED" | "DISTANCE";
  deliveryFee: number;
  minFee: number | null;
  perKmFee: number | null;
  maxFee: number | null;
};

export type Point = { latitude: number; longitude: number };

// Distance à vol d'oiseau, en km.
export function distanceKm(a: Point, b: Point): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// Arrondi aux 50 FCFA supérieurs, pour des prix faciles à rendre en monnaie.
const roundUp50 = (n: number) => Math.ceil(n / 50) * 50;

export function deliveryFee(zone: ZonePricingInput, km: number | null): number {
  if (zone.pricing === "FIXED" || km === null || !zone.perKmFee) return zone.deliveryFee;
  let fee = roundUp50(km * zone.perKmFee);
  if (zone.minFee !== null) fee = Math.max(fee, zone.minFee);
  if (zone.maxFee !== null) fee = Math.min(fee, zone.maxFee);
  return fee;
}

// Zone technique d'un colis qui attend la position du destinataire : cachée, remplacée à la réception de la position.
export const PARCEL_ZONE_ID = "parcels";

export type ParcelTariff = { parcelMinFee: number; parcelPerKmFee: number; parcelMaxFee: number };

// Colis : tarif au km des réglages (minimum, plafond si non nul). Sans point de livraison connu, le minimum.
export function parcelFee(t: ParcelTariff, km: number | null): number {
  return deliveryFee({ pricing: "DISTANCE", deliveryFee: t.parcelMinFee, minFee: t.parcelMinFee, perKmFee: t.parcelPerKmFee, maxFee: t.parcelMaxFee || null }, km);
}

// Colis : distance entre le retrait et la livraison (arrondie à 0,1 km), si les deux positions sont connues.
export function parcelDistanceKm(pickup: { latitude: number | null; longitude: number | null }, drop: { latitude: number | null; longitude: number | null }): number | null {
  if (pickup.latitude === null || pickup.longitude === null || drop.latitude === null || drop.longitude === null) return null;
  return Math.round(distanceKm(pickup as Point, drop as Point) * 10) / 10;
}

export function parcelExtraFee(category: { surcharge: number; perKgFee: number }, weightKg: number): number {
  return category.surcharge + roundUp50(Math.max(0, weightKg) * category.perKgFee);
}

export type CancellationRules = { freeCancellationMinutes: number; cancellationFeePercent: number };

// Frais retenus à l'annulation : gratuit pendant le délai de grâce et tant que le
// livreur n'a rien récupéré ; sinon un pourcentage des frais de livraison.
export function cancellationFee(
  order: { createdAt: Date; status: string; deliveryFee: number; extraFee: number },
  rules: CancellationRules,
  now = new Date(),
): number {
  const minutes = (now.getTime() - order.createdAt.getTime()) / 60_000;
  if (order.status !== "PICKED_UP" && minutes <= rules.freeCancellationMinutes) return 0;
  return Math.round(((order.deliveryFee + order.extraFee) * rules.cancellationFeePercent) / 100);
}

export function driverEarning(
  order: { type: "FOOD" | "PARCEL"; deliveryFee: number; extraFee: number },
  settings: { foodDriverCommission: number; parcelDriverCommission: number },
): number {
  const rate = order.type === "PARCEL" ? settings.parcelDriverCommission : settings.foodDriverCommission;
  return Math.round(((order.deliveryFee + order.extraFee) * rate) / 100);
}

// Zone d'une position : centre de zone le plus proche (à 15 km au plus), sinon zone du commerce le plus proche
// (à 3 km au plus), pour les zones dont l'admin n'a pas encore placé le centre.
export function nearestZone(
  p: Point,
  zones: { id: string; latitude: number | null; longitude: number | null }[],
  places: { zoneId: string | null; latitude: number | null; longitude: number | null }[],
): string | null {
  const closest = <T extends { latitude: number | null; longitude: number | null }>(list: T[], maxKm: number) => {
    let best: T | null = null;
    let bestKm = maxKm;
    for (const x of list) {
      if (x.latitude === null || x.longitude === null) continue;
      const km = distanceKm(p, { latitude: x.latitude, longitude: x.longitude });
      if (km <= bestKm) [best, bestKm] = [x, km];
    }
    return best;
  };
  return closest(zones, 15)?.id ?? closest(places.filter((r) => r.zoneId), 3)?.zoneId ?? null;
}

// Même recherche, sur les zones actives et les commerces en base.
export async function zoneForPoint(prisma: PrismaClient, p: Point): Promise<string | null> {
  const [zones, places] = await Promise.all([
    prisma.zone.findMany({ where: { active: true, id: { not: PARCEL_ZONE_ID } }, select: { id: true, latitude: true, longitude: true } }),
    prisma.restaurant.findMany({ where: { latitude: { not: null }, zone: { active: true } }, select: { zoneId: true, latitude: true, longitude: true } }),
  ]);
  return nearestZone(p, zones, places);
}
