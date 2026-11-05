import type { PrismaClient } from "@prisma/client";
import { parcelDeliveryFee, parcelDistanceKm, parcelExtraFee, PARCEL_ZONE_ID, pricingMode, zoneForPoint, type Point } from "./delivery.js";
import type { getSettings } from "./util.js";

type Settings = Awaited<ReturnType<typeof getSettings>>;

// Prix d'un colis, commun au formulaire public et à l'appli marchand. La zone se déduit de la position de
// livraison ; sans position ou hors des zones connues, « Zone à déterminer » (la répartition l'attribue).
// Le prix vient de la distance entre retrait et livraison, ou du prix de la zone selon les réglages.
export async function priceParcel(
  prisma: PrismaClient,
  settings: Settings,
  pickup: { latitude: number | null; longitude: number | null },
  drop: Point | null,
  category: { surcharge: number; perKgFee: number },
  weightKg: number,
) {
  const zoneId = (drop && (await zoneForPoint(prisma, drop))) || PARCEL_ZONE_ID;
  if (zoneId === PARCEL_ZONE_ID) await prisma.zone.upsert({ where: { id: PARCEL_ZONE_ID }, update: {}, create: { id: PARCEL_ZONE_ID, name: "Zone à déterminer", pricing: "DISTANCE", deliveryFee: 0, active: false } });
  const km = parcelDistanceKm(pickup, { latitude: drop?.latitude ?? null, longitude: drop?.longitude ?? null });
  const priceZone = zoneId === PARCEL_ZONE_ID ? null : await prisma.zone.findUnique({ where: { id: zoneId }, select: { id: true, name: true, deliveryFee: true } });
  const byZone = pricingMode(settings.parcelPricingMode) === "ZONE" && !!priceZone;
  return { zoneId, zoneName: priceZone?.name ?? "", km, byZone, fee: parcelDeliveryFee(settings, km, priceZone), extraFee: parcelExtraFee(category, weightKg) };
}

// Total d'une commande, ce que le livreur encaisse en espèces à la livraison. Colis d'un marchand dont il paie
// lui-même la livraison : seulement le contre-remboursement (frais moins remise, retenus sur son reversement).
export function orderTotal(o: { subtotal: number; discount: number; deliveryFee: number; extraFee: number; merchantId?: string | null; payer?: string | null }): number {
  if (o.merchantId && o.payer === "SENDER") return o.subtotal;
  return o.subtotal - o.discount + o.deliveryFee + o.extraFee;
}

// Ce que Zedeka doit au marchand pour un colis livré : espèces reçues moins la livraison (frais moins remise).
// Destinataire qui paie la livraison : il reste le contre-remboursement. Négatif : le marchand doit les frais.
export function merchantNet(o: { cashCollected: number | null; total: number; deliveryFee: number; extraFee: number; discount: number }): number {
  return (o.cashCollected ?? o.total) - (o.deliveryFee + o.extraFee - o.discount);
}
