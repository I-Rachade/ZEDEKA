"use client";

import { panelApi } from "@/components/panel/panelApi";

export const rental = panelApi("location", "/location/connexion");

export type TripStatus = "PENDING" | "CONFIRMED" | "ONGOING" | "COMPLETED" | "CANCELLED" | "PAYMENT_FAILED";
export type RentalPricing = "HOURLY" | "DAILY" | "DISTANCE";

export const TRIP_LABEL: Record<TripStatus, string> = {
  PENDING: "En attente",
  CONFIRMED: "Confirmée",
  ONGOING: "En cours",
  COMPLETED: "Terminée",
  CANCELLED: "Annulée",
  PAYMENT_FAILED: "Paiement échoué",
};

const TRIP_COLOR: Record<TripStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-sky-100 text-sky-800",
  ONGOING: "bg-violet-100 text-violet-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-stone-200 text-stone-600",
  PAYMENT_FAILED: "bg-red-100 text-red-700",
};

export function TripPill({ status }: { status: TripStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TRIP_COLOR[status]}`}>{TRIP_LABEL[status]}</span>;
}

export const PRICING_LABEL: Record<RentalPricing, string> = { HOURLY: "À l'heure", DAILY: "À la journée", DISTANCE: "Au km" };
export const PRICING_UNIT: Record<RentalPricing, string> = { HOURLY: "h", DAILY: "j", DISTANCE: "km" };

export type VehicleUnit = { id: string; plateNumber: string; vin: string | null; active: boolean };

export type Vehicle = {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  images: string[];
  brand: string;
  model: string;
  category: string;
  type: string;
  seats: number;
  airConditioning: boolean;
  fuel: string;
  transmission: string;
  engineCc: number | null;
  powerHp: number | null;
  hourlyPrice: number | null;
  dailyPrice: number | null;
  perKmPrice: number | null;
  discountPercent: number;
  active: boolean;
  units: VehicleUnit[];
  createdAt: string;
  _count?: { tripVehicles: number };
};

export type RentalDriver = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  photoUrl: string | null;
  idType: string | null;
  idNumber: string | null;
  idImageUrl: string | null;
  active: boolean;
  trips?: number;
  completed?: number;
  cancelled?: number;
};

export type Trip = {
  id: string;
  code: string;
  status: TripStatus;
  pricing: RentalPricing;
  scheduledAt: string | null;
  duration: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  pickupAddress: string;
  pickupLatitude: number | null;
  pickupLongitude: number | null;
  destinationAddress: string;
  note: string | null;
  fare: number;
  discount: number;
  extraDiscount: number;
  extraFee: number;
  tax: number;
  total: number;
  commission: number;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  paymentStatus: "UNPAID" | "PAID";
  cancellationReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  provider: { name: string; phone: string; slug: string };
  driver: { id: string; firstName: string; lastName: string; phone: string } | null;
  vehicles: {
    id: string;
    vehicleId: string;
    name: string;
    unitPrice: number;
    quantity: number;
    duration: number;
    discount: number;
    price: number;
    unit: { id: string; plateNumber: string } | null;
    vehicle: { imageUrl: string | null; category: string };
  }[];
};

export type Provider = {
  id: string;
  slug: string;
  name: string;
  phone: string;
  address: string;
  logoUrl: string | null;
  commissionRate: number;
  temporarilyClosed: boolean;
  scheduledTrips: boolean;
  pickupZoneId: string | null;
  pickupZone: { name: string } | null;
  pickupTimeMin: number;
  pickupTimeMax: number;
  taxPercent: number;
  ownerEmail?: string | null;
  availability: { open: boolean; reason: string | null };
};

export type RentalSettlement = {
  id: string;
  periodStart: string;
  periodEnd: string;
  tripCount: number;
  tripTotal: number;
  commission: number;
  amountDue: number;
  paidAt: string | null;
};

export const driverName = (d: { firstName: string; lastName: string }) => `${d.firstName} ${d.lastName}`;

export function tripSteps(t: Pick<Trip, "createdAt" | "confirmedAt" | "startedAt" | "completedAt">) {
  return [
    { label: "En attente", at: t.createdAt },
    { label: "Confirmée", at: t.confirmedAt },
    { label: "En cours", at: t.startedAt },
    { label: "Terminée", at: t.completedAt },
  ];
}
