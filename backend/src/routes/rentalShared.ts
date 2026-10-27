import { closedNow } from "../openingHours.js";
import type { Prisma, PrismaClient, RentalProvider } from "@prisma/client";
import { z } from "zod";
import { tripCode, tripCommission, tripPrice } from "../rental.js";

// Éléments communs aux routes publiques, à l'espace loueur et à l'admin.

export const tripInclude = {
  provider: { select: { name: true, phone: true, slug: true } },
  driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
  vehicles: { include: { unit: { select: { id: true, plateNumber: true } }, vehicle: { select: { imageUrl: true, category: true } } } },
} satisfies Prisma.TripInclude;

export function rentalAvailability(p: Pick<RentalProvider, "active" | "temporarilyClosed"> & { closedUntil?: Date | null }) {
  if (!p.active) return { open: false, reason: "Ce loueur ne prend pas de réservations pour le moment." };
  if (closedNow(p)) return { open: false, reason: "Le loueur est momentanément fermé." };
  return { open: true, reason: null };
}

export const vehicleInput = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().default(null),
  imageUrl: z.string().trim().url("lien invalide").max(500).nullable().default(null),
  images: z.array(z.string().trim().url("lien invalide").max(500)).max(10).default([]),
  brand: z.string().trim().min(1).max(40),
  model: z.string().trim().min(1).max(40),
  category: z.string().trim().min(1).max(40),
  type: z.string().trim().min(1).max(40),
  seats: z.number().int().min(1).max(60),
  airConditioning: z.boolean().default(true),
  fuel: z.string().trim().min(1).max(20),
  transmission: z.string().trim().min(1).max(20),
  engineCc: z.number().int().min(0).max(10000).nullable().default(null),
  powerHp: z.number().int().min(0).max(2000).nullable().default(null),
  hourlyPrice: z.number().int().min(0).max(10_000_000).nullable().default(null),
  dailyPrice: z.number().int().min(0).max(10_000_000).nullable().default(null),
  perKmPrice: z.number().int().min(0).max(1_000_000).nullable().default(null),
  discountPercent: z.number().int().min(0).max(90).default(0),
  active: z.boolean().default(true),
});

export const unitsInput = z.object({
  units: z.array(z.object({ plateNumber: z.string().trim().min(2).max(20), vin: z.string().trim().max(40).nullable().default(null) })).max(50),
});

// Recalcule les montants d'une course à partir de ses lignes et des réglages du loueur.
export async function repriceTrip(
  prisma: PrismaClient | Prisma.TransactionClient,
  tripId: string,
  change: { duration?: number; extraFee?: number; extraDiscount?: number } = {},
) {
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    include: { vehicles: { include: { vehicle: { select: { discountPercent: true } } } }, provider: true },
  });
  const duration = change.duration ?? trip.duration;
  const price = tripPrice(
    trip.vehicles.map((v) => ({ name: v.name, unitPrice: v.unitPrice, quantity: v.quantity, discountPercent: v.vehicle.discountPercent })),
    duration,
    { extraDiscount: change.extraDiscount ?? trip.extraDiscount, extraFee: change.extraFee ?? trip.extraFee, taxPercent: trip.provider.taxPercent },
  );
  await Promise.all(
    trip.vehicles.map((v, i) => prisma.tripVehicle.update({ where: { id: v.id }, data: { duration, price: price.lines[i].price, discount: price.lines[i].discount } })),
  );
  return prisma.trip.update({
    where: { id: tripId },
    data: {
      duration,
      extraDiscount: change.extraDiscount ?? trip.extraDiscount,
      fare: price.fare,
      discount: price.discount,
      extraFee: price.extraFee,
      tax: price.tax,
      total: price.total,
      commission: tripCommission(price, trip.provider.commissionRate),
    },
    include: tripInclude,
  });
}

export async function createTripWithCode(prisma: PrismaClient, data: Omit<Prisma.TripUncheckedCreateInput, "code">) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.trip.create({ data: { ...data, code: tripCode() }, include: tripInclude });
    } catch (e) {
      if (attempt < 4 && (e as { code?: string }).code === "P2002") continue;
      throw e;
    }
  }
}

export function tripTotals(trips: { total: number; commission: number }[]) {
  const tripTotal = trips.reduce((s, t) => s + t.total, 0);
  const commission = trips.reduce((s, t) => s + t.commission, 0);
  return { tripCount: trips.length, tripTotal, commission, amountDue: tripTotal - commission };
}
