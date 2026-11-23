import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { availability, book, BOOK_AHEAD_DAYS, dayStart, offers, SERVICES, ticketView, type Service } from "../charging.js";
import { normalizePhone } from "../customer.js";
import type { Notifier } from "../notify.js";
import { formatFcfa, normalizeCode } from "../pricing.js";
import { firstError } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Page publique /recharge : stations de recharge et d'échange de batteries de Zedeka, ouvertes à toutes les motos.
// Sans compte : nom, numéro et plaque suffisent ; le ticket se retrouve avec son code et le numéro.

const stationPublic = {
  id: true,
  name: true,
  kind: true,
  address: true,
  latitude: true,
  longitude: true,
  chargePoints: true,
  swapBays: true,
  chargePrice: true,
  swapPrice: true,
  slotMinutes: true,
  opensAt: true,
  closesAt: true,
  note: true,
} as const;

const bookInput = z.object({
  stationId: z.string().min(1),
  service: z.enum(SERVICES),
  startsAt: z.string().datetime({ message: "Créneau invalide" }),
  name: z.string().trim().min(2, "Indiquez votre nom").max(80),
  phone: z.string().trim().min(8).max(20),
  plate: z.string().trim().min(3, "Indiquez la plaque").max(20),
  bikeModel: z.string().trim().max(60).optional(),
});

export function chargingPublicRouter(prisma: PrismaClient, config: { notifier: Notifier }) {
  const router = Router();

  router.get("/recharge/stations", async (_req, res) => {
    res.json(await prisma.chargingStation.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: stationPublic }));
  });

  // Créneaux d'un jour (aujourd'hui par défaut) pour un service, avec les places restantes.
  router.get("/recharge/stations/:id/slots", async (req, res) => {
    const service = z.enum(SERVICES).catch("CHARGE").parse(req.query.service) as Service;
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = (typeof req.query.day === "string" && dayStart(req.query.day)) || today;
    if (day < today || day.getTime() - today.getTime() > BOOK_AHEAD_DAYS * 86_400_000) {
      res.status(400).json({ error: `Réservation au plus ${BOOK_AHEAD_DAYS} jours à l'avance` });
      return;
    }
    const station = await prisma.chargingStation.findFirst({ where: { id: req.params.id, active: true } });
    if (!station || !offers(station, service)) {
      res.status(404).json({ error: "Station introuvable" });
      return;
    }
    const bookings = await prisma.chargingBooking.findMany({
      where: { stationId: station.id, startsAt: { lt: new Date(day.getTime() + 86_400_000) }, endsAt: { gt: day } },
      select: { service: true, startsAt: true, endsAt: true, status: true },
    });
    res.json({ day: day.toISOString().slice(0, 10), slots: availability(station, service, day, bookings, now) });
  });

  router.post("/recharge/bookings", async (req, res) => {
    const parsed = bookInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const b = await book(prisma, { ...parsed.data, startsAt: new Date(parsed.data.startsAt) });
      void config.notifier
        .staff("DRIVERS", {
          title: `Recharge réservée : ${b.station.name}`,
          body: `${b.name} · ${b.plate} · ${b.startsAt.toISOString().slice(11, 16)} · ${formatFcfa(b.price)}`,
          url: "/admin/recharge",
          tag: `charging-${b.id}`,
        })
        .catch(() => {});
      res.status(201).json(ticketView(b));
    } catch (e) {
      if (!(e instanceof HttpError)) throw e;
      res.status(e.status).json({ error: e.message });
    }
  });

  // Ticket : code et numéro de téléphone utilisé (pas de liste des réservations d'un numéro).
  async function findTicket(code: string, rawPhone: unknown) {
    const phone = typeof rawPhone === "string" ? normalizePhone(rawPhone) : null;
    if (!phone) return null;
    return prisma.chargingBooking.findFirst({ where: { code: normalizeCode(code), phone }, include: { station: true } });
  }

  router.get("/recharge/bookings/:code", async (req, res) => {
    const b = await findTicket(req.params.code, req.query.phone);
    if (!b) {
      res.status(404).json({ error: "Réservation introuvable" });
      return;
    }
    res.json(ticketView(b));
  });

  router.post("/recharge/bookings/:code/cancel", async (req, res) => {
    const b = await findTicket(req.params.code, req.body?.phone);
    if (!b) {
      res.status(404).json({ error: "Réservation introuvable" });
      return;
    }
    const { count } = await prisma.chargingBooking.updateMany({ where: { id: b.id, status: "BOOKED" }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (!count) {
      res.status(409).json({ error: "Cette réservation ne peut plus être annulée" });
      return;
    }
    res.json(ticketView({ ...b, status: "CANCELLED" }));
  });

  return router;
}
