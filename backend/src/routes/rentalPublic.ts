import { type Request, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { formatFcfa, whatsappUrl } from "../pricing.js";
import { PRICING_UNIT, tripCommission, tripPrice, unitPrice } from "../rental.js";
import { acceptTerms, firstError, phone } from "../util.js";
import { linkedCustomerId } from "./customer.js";
import type { Notifier } from "../notify.js";
import { createTripWithCode, rentalAvailability } from "./rentalShared.js";

// Côté client : voir la flotte d'un loueur et réserver.

const bookingInput = z.object({
  providerSlug: z.string().min(1),
  vehicleId: z.string().min(1),
  quantity: z.number().int().min(1).max(10).default(1),
  pricing: z.enum(["HOURLY", "DAILY", "DISTANCE"]),
  duration: z.number().int().min(1).max(1000),
  scheduledAt: z.string().datetime({ offset: true }).optional(),
  customerName: z.string().trim().min(2).max(80),
  customerPhone: phone,
  customerEmail: z.string().trim().email("e-mail invalide").optional(),
  pickupAddress: z.string().trim().min(5).max(300),
  destinationAddress: z.string().trim().min(3).max(300),
  pickupLatitude: z.number().min(-90).max(90).optional(),
  pickupLongitude: z.number().min(-180).max(180).optional(),
  note: z.string().trim().max(300).optional(),
  paymentMethod: z.enum(["CASH", "MOBILE_MONEY"]),
  acceptTerms,
});

export function rentalPublicRouter(prisma: PrismaClient, config: { zedekaWhatsapp: string; secret: string; notifier: Notifier }) {
  const router = Router();

  // Loueurs actifs pour l'application, avec leurs types de véhicules.
  router.get("/rentals", async (_req, res) => {
    const providers = await prisma.rentalProvider.findMany({
      where: { active: true, vehicles: { some: { active: true } } },
      orderBy: { name: "asc" },
      select: {
        slug: true,
        name: true,
        address: true,
        logoUrl: true,
        active: true,
        temporarilyClosed: true,
        closedUntil: true,
        pickupTimeMin: true,
        pickupTimeMax: true,
        pickupZone: { select: { name: true } },
        vehicles: { where: { active: true }, select: { name: true, hourlyPrice: true, dailyPrice: true } },
      },
    });
    res.json(
      providers.map(({ active: _a, temporarilyClosed: _t, closedUntil: _c, vehicles, ...p }) => {
        const prices = vehicles.flatMap((v) => [v.hourlyPrice, v.dailyPrice]).filter((n): n is number => n !== null);
        return {
          ...p,
          availability: rentalAvailability({ active: _a, temporarilyClosed: _t, closedUntil: _c }),
          vehicleCount: vehicles.length,
          vehicles: vehicles.map((v) => v.name).slice(0, 3),
          priceFrom: prices.length ? Math.min(...prices) : null,
        };
      }),
    );
  });

  router.get("/rentals/:slug", async (req, res) => {
    const provider = await prisma.rentalProvider.findUnique({
      where: { slug: req.params.slug },
      omit: { ownerPasswordHash: true, ownerEmail: true, commissionRate: true, sessionsValidFrom: true },
      include: {
        pickupZone: { select: { name: true } },
        vehicles: { where: { active: true }, orderBy: { name: "asc" }, include: { _count: { select: { units: { where: { active: true } } } } } },
      },
    });
    if (!provider || !provider.active) {
      res.status(404).json({ error: "Loueur introuvable" });
      return;
    }
    res.json({ ...provider, availability: rentalAvailability(provider) });
  });

  router.post("/trips", async (req, res) => {
    const parsed = bookingInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const input = parsed.data;
    const provider = await prisma.rentalProvider.findUnique({ where: { slug: input.providerSlug } });
    if (!provider) {
      res.status(404).json({ error: "Loueur introuvable" });
      return;
    }
    const open = rentalAvailability(provider);
    if (!open.open) {
      res.status(409).json({ error: open.reason });
      return;
    }
    if (input.scheduledAt && !provider.scheduledTrips) {
      res.status(400).json({ error: "Ce loueur n'accepte pas les réservations à l'avance" });
      return;
    }
    if (input.scheduledAt && new Date(input.scheduledAt).getTime() < Date.now() - 60_000) {
      res.status(400).json({ error: "La date de départ est passée" });
      return;
    }
    const vehicle = await prisma.vehicle.findFirst({ where: { id: input.vehicleId, providerId: provider.id, active: true } });
    const price = vehicle && unitPrice(vehicle, input.pricing);
    if (!vehicle || price === null || price === undefined) {
      res.status(400).json({ error: "Ce véhicule n'est pas proposé avec ce tarif" });
      return;
    }

    const priced = tripPrice([{ name: vehicle.name, unitPrice: price, quantity: input.quantity, discountPercent: vehicle.discountPercent }], input.duration, {
      taxPercent: provider.taxPercent,
    });
    const line = priced.lines[0];
    const trip = await createTripWithCode(prisma, {
      providerId: provider.id,
      customerId: await linkedCustomerId(prisma, req, config.secret),
      termsAcceptedAt: new Date(),
      pricing: input.pricing,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      duration: input.duration,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      customerEmail: input.customerEmail ?? null,
      pickupAddress: input.pickupAddress,
      pickupLatitude: input.pickupLatitude,
      pickupLongitude: input.pickupLongitude,
      destinationAddress: input.destinationAddress,
      note: input.note || null,
      paymentMethod: input.paymentMethod,
      fare: priced.fare,
      discount: priced.discount,
      tax: priced.tax,
      total: priced.total,
      commission: tripCommission(priced, provider.commissionRate),
      vehicles: {
        create: [{ vehicleId: vehicle.id, name: vehicle.name, unitPrice: price, quantity: input.quantity, duration: input.duration, discount: line.discount, price: line.price }],
      },
    });

    void config.notifier.push("rental", provider.id, {
      title: `Nouvelle réservation ${trip.code}`,
      body: `${vehicle.name} · ${formatFcfa(trip.total)}${trip.scheduledAt ? " · pour plus tard" : ""}`,
      url: `/location/courses/${trip.id}`,
      tag: `trip-${trip.id}`,
      alarm: true,
    });

    const message = [
      `Nouvelle réservation ${trip.code}`,
      `Loueur : ${provider.name}`,
      "",
      `${input.quantity} × ${vehicle.name}, ${input.duration} ${PRICING_UNIT[input.pricing]}`,
      `Départ : ${input.scheduledAt ? new Date(input.scheduledAt).toLocaleString("fr-FR", { timeZone: "UTC" }) : "dès que possible"}`,
      `De : ${input.pickupAddress}`,
      `À : ${input.destinationAddress}`,
      "",
      `Total : ${formatFcfa(trip.total)}`,
      `Paiement : ${input.paymentMethod === "CASH" ? "Espèces" : "Mobile money"}`,
      `Client : ${input.customerName}, ${input.customerPhone}`,
    ].join("\n");
    res.status(201).json({ code: trip.code, total: trip.total, whatsappUrl: whatsappUrl(config.zedekaWhatsapp, message) });
  });

  router.get("/trips/:code", async (req, res) => {
    const trip = await prisma.trip.findUnique({
      where: { code: req.params.code.toUpperCase() },
      select: {
        code: true,
        status: true,
        pricing: true,
        duration: true,
        scheduledAt: true,
        pickupAddress: true,
        destinationAddress: true,
        total: true,
        createdAt: true,
        provider: { select: { name: true, phone: true } },
        vehicles: { select: { name: true, quantity: true } },
      },
    });
    if (!trip) {
      res.status(404).json({ error: "Réservation introuvable" });
      return;
    }
    res.json(trip);
  });

  return router;
}
