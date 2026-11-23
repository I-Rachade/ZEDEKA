import type { PrismaClient } from "@prisma/client";
import { normalizePhone } from "./customer.js";
import { publicCode } from "./pricing.js";
import { HttpError } from "./routes/adminWrite.js";

// Recharge ouverte à toutes les motos électriques (livreurs Zedeka, taxis-motos, particuliers) : chaque station de
// Zedeka propose la recharge sur borne (CHARGE) et/ou l'échange de batterie (SWAP). On réserve un créneau sur la page
// publique /recharge (ticket avec un code), ou on passe sans réservation : l'équipe de la station note le passage.
// Lomé vit à l'heure UTC : les heures d'ouverture et les créneaux sont en UTC.

export const SERVICES = ["CHARGE", "SWAP"] as const;
export type Service = (typeof SERVICES)[number];
export const SERVICE_LABEL: Record<Service, string> = { CHARGE: "Recharge sur borne", SWAP: "Échange de batterie" };
export const BOOKING_STATUSES = ["BOOKED", "CHECKED_IN", "DONE", "CANCELLED", "NO_SHOW"] as const;
// Réservations qui occupent un créneau.
export const HOLDING = ["BOOKED", "CHECKED_IN", "DONE"];
// Réservations à venir au plus par numéro (évite qu'un seul numéro bloque une station).
export const MAX_ACTIVE_PER_PHONE = 3;
// On réserve jusqu'à 7 jours à l'avance.
export const BOOK_AHEAD_DAYS = 7;

export type StationLike = {
  kind: string;
  chargePoints: number;
  swapBays: number;
  chargePrice: number;
  swapPrice: number;
  slotMinutes: number;
  opensAt: string;
  closesAt: string;
};

export const offers = (s: { kind: string }, service: Service) => s.kind === "BOTH" || s.kind === service;
export const capacityOf = (s: StationLike, service: Service) => (service === "CHARGE" ? s.chargePoints : s.swapBays);
export const priceOf = (s: StationLike, service: Service) => (service === "CHARGE" ? s.chargePrice : s.swapPrice);

// Heure « HH:MM » vérifiée caractère par caractère, en minutes depuis minuit.
export function minutesOf(hhmm: string): number | null {
  if (hhmm.length !== 5 || hhmm[2] !== ":") return null;
  const h = Number(hhmm.slice(0, 2));
  const m = Number(hhmm.slice(3));
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

export function dayStart(day: string): Date | null {
  const ok = day.length === 10 && [...day].every((ch, i) => (i === 4 || i === 7 ? ch === "-" : ch >= "0" && ch <= "9"));
  const d = new Date(`${day}T00:00:00Z`);
  return ok && !Number.isNaN(d.getTime()) ? d : null;
}

// Créneaux d'une journée, de l'ouverture à la fermeture.
export function slotsOf(s: StationLike, day: Date): { startsAt: Date; endsAt: Date }[] {
  const open = minutesOf(s.opensAt);
  const close = minutesOf(s.closesAt);
  const step = Math.max(15, s.slotMinutes);
  if (open === null || close === null || close <= open) return [];
  const out = [];
  for (let m = open; m + step <= close; m += step) {
    const startsAt = new Date(day.getTime() + m * 60_000);
    out.push({ startsAt, endsAt: new Date(startsAt.getTime() + step * 60_000) });
  }
  return out;
}

// Places restantes de chaque créneau, en tenant compte des réservations qui le chevauchent. Les créneaux passés
// (ou qui commencent dans moins de 10 minutes) ne sont plus proposés.
export function availability(
  s: StationLike,
  service: Service,
  day: Date,
  bookings: { service: string; startsAt: Date; endsAt: Date; status: string }[],
  now = new Date(),
) {
  const cap = capacityOf(s, service);
  return slotsOf(s, day).map((slot) => {
    const taken = bookings.filter((b) => b.service === service && HOLDING.includes(b.status) && b.startsAt < slot.endsAt && b.endsAt > slot.startsAt).length;
    const open = slot.startsAt.getTime() - now.getTime() >= 10 * 60_000;
    return { startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), left: open ? Math.max(0, cap - taken) : 0 };
  });
}

// Plaque saisie : majuscules, espaces et tirets gardés, 3 à 15 caractères.
export function cleanPlate(raw: string): string | null {
  const p = raw.trim().toUpperCase().replace(/\s+/g, " ");
  return p.length >= 3 && p.length <= 15 && [...p].every((ch) => (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === " " || ch === "-") ? p : null;
}

type BookInput = { stationId: string; service: Service; startsAt: Date; name: string; phone: string; plate: string; bikeModel?: string | null };

// Réservation d'un créneau : station ouverte qui propose ce service, créneau exact de la journée, encore de la
// place, et pas trop de réservations à venir pour ce numéro. Le créneau est revérifié après l'écriture : si deux
// réservations prennent la dernière place en même temps, la seconde est annulée.
export async function book(prisma: PrismaClient, input: BookInput, opts: { source?: "ONLINE" | "STATION"; now?: Date; handledBy?: string | null } = {}) {
  const now = opts.now ?? new Date();
  const phone = normalizePhone(input.phone);
  if (!phone) throw new HttpError(400, "Numéro togolais invalide (8 chiffres)");
  const plate = cleanPlate(input.plate);
  if (!plate) throw new HttpError(400, "Plaque invalide");
  const station = await prisma.chargingStation.findFirst({ where: { id: input.stationId, active: true } });
  if (!station) throw new HttpError(404, "Station introuvable");
  if (!offers(station, input.service)) throw new HttpError(400, "Ce service n'est pas proposé dans cette station");

  const walkIn = opts.source === "STATION";
  const day = new Date(Date.UTC(input.startsAt.getUTCFullYear(), input.startsAt.getUTCMonth(), input.startsAt.getUTCDate()));
  let slot = slotsOf(station, day).find((s) => s.startsAt.getTime() === input.startsAt.getTime());
  if (walkIn) {
    // Passage sans réservation : il commence maintenant, pour la durée d'un créneau.
    const step = Math.max(15, station.slotMinutes) * 60_000;
    slot = { startsAt: now, endsAt: new Date(now.getTime() + step) };
  } else {
    if (!slot) throw new HttpError(400, "Créneau invalide");
    if (slot.startsAt.getTime() - now.getTime() < 10 * 60_000) throw new HttpError(409, "Ce créneau est passé : choisissez-en un autre");
    if (slot.startsAt.getTime() - now.getTime() > BOOK_AHEAD_DAYS * 86_400_000) throw new HttpError(400, `Réservation au plus ${BOOK_AHEAD_DAYS} jours à l'avance`);
    const active = await prisma.chargingBooking.count({ where: { phone, status: "BOOKED", startsAt: { gte: now } } });
    if (active >= MAX_ACTIVE_PER_PHONE) throw new HttpError(429, `${MAX_ACTIVE_PER_PHONE} réservations à venir au plus par numéro`);
  }
  const cap = capacityOf(station, input.service);
  const overlap = { stationId: station.id, service: input.service, status: { in: HOLDING }, startsAt: { lt: slot.endsAt }, endsAt: { gt: slot.startsAt } };
  if (!walkIn && (await prisma.chargingBooking.count({ where: overlap })) >= cap) throw new HttpError(409, "Ce créneau est complet : choisissez-en un autre");

  // Livreur de Zedeka reconnu par son numéro (statistiques : motos Zedeka ou non).
  const driver = await prisma.driver.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
  let created;
  for (let attempt = 0; ; attempt++) {
    try {
      created = await prisma.chargingBooking.create({
        data: {
          code: publicCode("ZR"),
          stationId: station.id,
          service: input.service,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          name: input.name.trim(),
          phone,
          plate,
          bikeModel: input.bikeModel?.trim() || null,
          driverId: driver?.id ?? null,
          price: priceOf(station, input.service),
          source: walkIn ? "STATION" : "ONLINE",
          status: walkIn ? "CHECKED_IN" : "BOOKED",
          checkedInAt: walkIn ? now : null,
          handledBy: opts.handledBy ?? null,
        },
        include: { station: true },
      });
      break;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002" || attempt >= 4) throw e;
    }
  }
  if (!walkIn) {
    // Dernière place prise en même temps par quelqu'un d'autre : la réservation la plus récente cède.
    const holders = await prisma.chargingBooking.findMany({ where: overlap, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (holders.findIndex((h) => h.id === created.id) >= cap) {
      await prisma.chargingBooking.update({ where: { id: created.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      throw new HttpError(409, "Ce créneau est complet : choisissez-en un autre");
    }
  }
  return created;
}

// Ticket public d'une réservation (sans le numéro complet du client).
export function ticketView(b: {
  code: string;
  service: string;
  startsAt: Date;
  endsAt: Date;
  name: string;
  phone: string;
  plate: string;
  price: number;
  status: string;
  paidAmount: number | null;
  station: { name: string; address: string; latitude: number | null; longitude: number | null };
}) {
  return {
    code: b.code,
    service: b.service,
    serviceLabel: SERVICE_LABEL[b.service as Service] ?? b.service,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    name: b.name,
    phone: `•••• ${b.phone.slice(-4)}`,
    plate: b.plate,
    price: b.price,
    status: b.status,
    paidAmount: b.paidAmount,
    station: { name: b.station.name, address: b.station.address, latitude: b.station.latitude, longitude: b.station.longitude },
  };
}
