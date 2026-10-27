import type { Prisma, RentalPricing, Trip, TripStatus } from "@prisma/client";

// Location de véhicules : prix et cycle de vie d'une course (« trip »).

export const TRIP_STATUSES = ["PENDING", "CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED", "PAYMENT_FAILED"] as const;
export const TRIP_OPEN: TripStatus[] = ["PENDING", "CONFIRMED", "ONGOING"];

export type PriceableVehicle = { hourlyPrice: number | null; dailyPrice: number | null; perKmPrice: number | null; discountPercent: number };

export function unitPrice(v: PriceableVehicle, pricing: RentalPricing): number | null {
  return pricing === "HOURLY" ? v.hourlyPrice : pricing === "DAILY" ? v.dailyPrice : v.perKmPrice;
}

export type TripLineInput = { name: string; unitPrice: number; quantity: number; discountPercent: number };
export type TripLine = TripLineInput & { duration: number; price: number; discount: number };
export type TripPrice = { lines: TripLine[]; fare: number; discount: number; extraFee: number; tax: number; total: number };

// Par véhicule : prix unitaire × quantité × durée, moins la remise du véhicule.
// Puis remise manuelle, frais supplémentaires et taxe (calculée sur le montant après remises et frais).
export function tripPrice(
  lines: TripLineInput[],
  duration: number,
  opts: { extraDiscount?: number; extraFee?: number; taxPercent?: number } = {},
): TripPrice {
  const priced = lines.map((l) => {
    const price = l.unitPrice * l.quantity * duration;
    return { ...l, duration, price, discount: Math.round((price * l.discountPercent) / 100) };
  });
  const fare = priced.reduce((s, l) => s + l.price, 0);
  const discount = Math.min(fare, priced.reduce((s, l) => s + l.discount, 0) + (opts.extraDiscount ?? 0));
  const extraFee = opts.extraFee ?? 0;
  const tax = Math.round(((fare - discount + extraFee) * (opts.taxPercent ?? 0)) / 100);
  return { lines: priced, fare, discount, extraFee, tax, total: fare - discount + extraFee + tax };
}

// Commission Zedeka : pourcentage du prix hors taxe, après remises.
export const tripCommission = (p: Pick<TripPrice, "fare" | "discount" | "extraFee">, rate: number) =>
  Math.round(((p.fare - p.discount + p.extraFee) * rate) / 100);

const MOVES: Partial<Record<TripStatus, TripStatus[]>> = {
  PENDING: ["CONFIRMED", "CANCELLED", "PAYMENT_FAILED"],
  CONFIRMED: ["ONGOING", "CANCELLED", "PAYMENT_FAILED"],
  ONGOING: ["COMPLETED", "CANCELLED"],
  PAYMENT_FAILED: ["PENDING", "CANCELLED"],
};

export const canMoveTrip = (from: TripStatus, to: TripStatus) => MOVES[from]?.includes(to) ?? false;

export function tripStatusUpdate(trip: Pick<Trip, "status">, to: TripStatus, reason?: string, now = new Date()): Prisma.TripUpdateInput {
  const data: Prisma.TripUpdateInput = { status: to };
  if (to === "CONFIRMED") data.confirmedAt = now;
  if (to === "ONGOING") data.startedAt = now;
  if (to === "COMPLETED") {
    data.completedAt = now;
    data.paymentStatus = "PAID";
  }
  if (to === "CANCELLED") {
    data.cancelledAt = now;
    data.cancellationReason = reason ?? null;
  }
  if (to === "PENDING" && trip.status === "PAYMENT_FAILED") data.paymentStatus = "UNPAID";
  return data;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function tripCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `ZL-${code}`;
}

export const PRICING_UNIT: Record<RentalPricing, string> = { HOURLY: "h", DAILY: "jour(s)", DISTANCE: "km" };
