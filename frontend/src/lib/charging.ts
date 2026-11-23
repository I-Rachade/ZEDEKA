"use client";

// Recharge ouverte à toutes les motos : stations, créneaux et tickets (page /recharge), et l'admin « Recharge ».

export type ChargingService = "CHARGE" | "SWAP";
export type ChargingStation = {
  id: string;
  name: string;
  kind: "CHARGE" | "SWAP" | "BOTH";
  address: string;
  latitude: number | null;
  longitude: number | null;
  chargePoints: number;
  swapBays: number;
  chargePrice: number;
  swapPrice: number;
  slotMinutes: number;
  opensAt: string;
  closesAt: string;
  note: string | null;
  active?: boolean;
};
export type Slot = { startsAt: string; endsAt: string; left: number };
export type BookingStatus = "BOOKED" | "CHECKED_IN" | "DONE" | "CANCELLED" | "NO_SHOW";
export type ChargingTicket = {
  code: string;
  service: ChargingService;
  serviceLabel: string;
  startsAt: string;
  endsAt: string;
  name: string;
  phone: string;
  plate: string;
  price: number;
  status: BookingStatus;
  paidAmount: number | null;
  station: { name: string; address: string; latitude: number | null; longitude: number | null };
};

export const SERVICE_LABEL: Record<ChargingService, string> = { CHARGE: "Recharge sur borne", SWAP: "Échange de batterie" };
export const BOOKING_STATUS: Record<BookingStatus, [string, string]> = {
  BOOKED: ["Réservé", "bg-sky-100 text-sky-800"],
  CHECKED_IN: ["À la station", "bg-amber-100 text-amber-800"],
  DONE: ["Terminé", "bg-emerald-100 text-emerald-800"],
  CANCELLED: ["Annulé", "bg-stone-200 text-stone-700"],
  NO_SHOW: ["Absent", "bg-red-100 text-red-700"],
};
export const offersService = (s: { kind: string }, service: ChargingService) => s.kind === "BOTH" || s.kind === service;
export const hhmm = (iso: string) => iso.slice(11, 16);
export const mapsUrl = (s: { latitude: number | null; longitude: number | null; address: string }) =>
  s.latitude !== null && s.longitude !== null ? `https://www.google.com/maps/search/?api=1&query=${s.latitude},${s.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.address)}`;

// Tickets gardés sur l'appareil (code et numéro), pour les retrouver sans compte.
export const TICKETS_KEY = "zedeka.chargingTickets";
export function savedTickets(): { code: string; phone: string }[] {
  try {
    return JSON.parse(localStorage.getItem(TICKETS_KEY) ?? "[]") as { code: string; phone: string }[];
  } catch {
    return [];
  }
}
export function saveTicket(code: string, phone: string) {
  try {
    const list = [{ code, phone }, ...savedTickets().filter((t) => t.code !== code)].slice(0, 10);
    localStorage.setItem(TICKETS_KEY, JSON.stringify(list));
  } catch {
    // Pas de stockage : le code reste affiché à l'écran.
  }
}
