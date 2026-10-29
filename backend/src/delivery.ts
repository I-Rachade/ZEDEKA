// Calculs de livraison : tarif de zone, distance, annulation, part du livreur.

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
