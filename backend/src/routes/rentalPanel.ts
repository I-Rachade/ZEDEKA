import { Router, type Response } from "express";
import type { Prisma, PrismaClient, TripStatus } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { issueToken, requireRental } from "../auth.js";
import { canMoveTrip, TRIP_STATUSES, tripStatusUpdate } from "../rental.js";
import { startOfDayUtc } from "../stats.js";
import { phone } from "../util.js";
import { HttpError, write } from "./adminWrite.js";
import type { Notifier } from "../notify.js";
import { partnerPrivateRoutes, partnerPublicRouter, sessionGuard, type PartnerStore } from "./partnerAccount.js";
import { rentalAvailability, repriceTrip, tripInclude, unitsInput, vehicleInput } from "./rentalShared.js";

// Espace loueur : chaque route ne voit que les données du loueur connecté.

const me = (res: Response) => String(res.locals.providerId);

const statusInput = z.object({
  status: z.enum(["CONFIRMED", "ONGOING", "COMPLETED", "CANCELLED", "PAYMENT_FAILED", "PENDING"]),
  reason: z.string().trim().min(3).max(300),
});

const tripEditInput = z.object({
  driverId: z.string().min(1).nullable(),
  duration: z.number().int().min(1).max(1000),
  extraFee: z.number().int().min(0).max(10_000_000),
  extraDiscount: z.number().int().min(0).max(10_000_000),
  paymentStatus: z.enum(["UNPAID", "PAID"]),
  scheduledAt: z.string().datetime({ offset: true }).nullable(),
  units: z.array(z.object({ tripVehicleId: z.string().min(1), unitId: z.string().min(1).nullable() })).max(20),
});

const driverInput = z.object({
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(40),
  phone,
  email: z.string().trim().email("e-mail invalide").nullable().default(null),
  photoUrl: z.string().trim().url("lien invalide").max(500).nullable().default(null),
  idType: z.string().trim().max(30).nullable().default(null),
  idNumber: z.string().trim().max(40).nullable().default(null),
  idImageUrl: z.string().trim().url("lien invalide").max(500).nullable().default(null),
  active: z.boolean().default(true),
});

const settingsInput = z.object({
  temporarilyClosed: z.boolean(),
  scheduledTrips: z.boolean(),
  pickupZoneId: z.string().min(1).nullable(),
  pickupTimeMin: z.number().int().min(0).max(240),
  pickupTimeMax: z.number().int().min(0).max(480),
  taxPercent: z.number().int().min(0).max(30),
  phone,
  address: z.string().trim().min(2),
  logoUrl: z.string().trim().url("lien invalide").max(500).nullable(),
});

export function tripListWhere(q: Record<string, unknown>): Prisma.TripWhereInput {
  const where: Prisma.TripWhereInput = {};
  if (q.status === "SCHEDULED") where.scheduledAt = { not: null };
  else {
    const status = TRIP_STATUSES.find((s) => s === q.status);
    if (status) where.status = status;
  }
  const search = typeof q.q === "string" ? q.q.trim() : "";
  if (search) {
    where.OR = [
      { code: { contains: search.toUpperCase() } },
      { customerPhone: { contains: search } },
      { customerName: { contains: search, mode: "insensitive" } },
    ];
  }
  return where;
}

export function rentalPanelRouter(prisma: PrismaClient, config: { secret: string; notifier: Notifier; devCodes: boolean }) {
  const router = Router();
  const store: PartnerStore = {
    byId: (id) => prisma.rentalProvider.findUnique({ where: { id } }),
    byEmail: (email) => prisma.rentalProvider.findUnique({ where: { ownerEmail: email } }),
    update: (id, data) => prisma.rentalProvider.update({ where: { id }, data }),
  };
  const deps = { prisma, role: "rental" as const, secret: config.secret, notifier: config.notifier, devCodes: config.devCodes, store, subject: me };

  router.post("/login", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const provider = email ? await prisma.rentalProvider.findUnique({ where: { ownerEmail: email } }) : null;
    const ok = provider?.ownerPasswordHash ? await bcrypt.compare(password, provider.ownerPasswordHash) : false;
    if (!provider || !ok || !config.secret) {
      res.status(401).json({ error: "E-mail ou mot de passe incorrect" });
      return;
    }
    res.json({ token: issueToken(config.secret, Date.now(), "rental", provider.id), name: provider.name });
  });

  router.use(partnerPublicRouter(deps));
  router.use(requireRental(config.secret), sessionGuard(deps));
  partnerPrivateRoutes(router, deps, "/location");

  const ownTrip = async (id: string, res: Response) => {
    const trip = await prisma.trip.findFirst({ where: { id, providerId: me(res) } });
    if (!trip) throw new HttpError(404, "Course introuvable");
    return trip;
  };
  const ownVehicle = async (id: string, res: Response) => {
    const v = await prisma.vehicle.findFirst({ where: { id, providerId: me(res) }, select: { id: true } });
    if (!v) throw new HttpError(404, "Véhicule introuvable");
  };
  const ownDriver = async (id: string, res: Response) => {
    const d = await prisma.rentalDriver.findFirst({ where: { id, providerId: me(res) }, select: { id: true } });
    if (!d) throw new HttpError(404, "Chauffeur introuvable");
  };

  router.get("/me", async (_req, res) => {
    const p = await prisma.rentalProvider.findUnique({
      where: { id: me(res) },
      omit: { ownerPasswordHash: true, sessionsValidFrom: true },
      include: { pickupZone: { select: { name: true } } },
    });
    if (!p) {
      res.status(401).json({ error: "Connexion requise" });
      return;
    }
    const zones = await prisma.zone.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    res.json({ ...p, availability: rentalAvailability(p), zones });
  });

  router.get("/dashboard", async (_req, res) => {
    const today = startOfDayUtc(new Date());
    const weekStart = new Date(today.getTime() - 6 * 86_400_000);
    const [byStatus, scheduled, completed, vehicles, drivers] = await Promise.all([
      prisma.trip.groupBy({ by: ["status"], _count: { _all: true }, where: { providerId: me(res) } }),
      prisma.trip.count({ where: { providerId: me(res), scheduledAt: { gte: new Date() }, status: { in: ["PENDING", "CONFIRMED"] } } }),
      prisma.trip.findMany({
        where: { providerId: me(res), status: "COMPLETED", completedAt: { gte: weekStart } },
        select: { total: true, commission: true, completedAt: true },
      }),
      prisma.vehicle.count({ where: { providerId: me(res), active: true } }),
      prisma.rentalDriver.count({ where: { providerId: me(res), active: true } }),
    ]);
    const sum = (rows: typeof completed) => ({ trips: rows.length, total: rows.reduce((s, t) => s + t.total, 0), net: rows.reduce((s, t) => s + t.total - t.commission, 0) });
    res.json({
      byStatus: Object.fromEntries(TRIP_STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0])),
      scheduled,
      today: sum(completed.filter((t) => t.completedAt! >= today)),
      week: sum(completed),
      vehicles,
      drivers,
    });
  });

  // --- Courses ---

  router.get("/trips", async (req, res) => {
    res.json(
      await prisma.trip.findMany({
        where: { ...tripListWhere(req.query), providerId: me(res) },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: tripInclude,
      }),
    );
  });

  router.get("/trips/counts", async (req, res) => {
    const { status: _ignored, ...rest } = req.query;
    const where = { ...tripListWhere(rest), providerId: me(res) };
    const [groups, scheduled] = await Promise.all([
      prisma.trip.groupBy({ by: ["status"], _count: { _all: true }, where }),
      prisma.trip.count({ where: { ...where, scheduledAt: { not: null } } }),
    ]);
    const counts = Object.fromEntries(TRIP_STATUSES.map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0]));
    res.json({ ...counts, SCHEDULED: scheduled, ALL: groups.reduce((sum, g) => sum + g._count._all, 0) });
  });

  router.get("/trips/:id", async (req, res) => {
    const trip = await prisma.trip.findFirst({ where: { id: req.params.id, providerId: me(res) }, include: tripInclude });
    if (!trip) {
      res.status(404).json({ error: "Course introuvable" });
      return;
    }
    res.json(trip);
  });

  router.post(
    "/trips/:id/status",
    write(
      statusInput,
      async (data, id, res) => {
        const trip = await ownTrip(id, res);
        const to = data.status as TripStatus;
        if (!canMoveTrip(trip.status, to)) throw new HttpError(409, "Action impossible à ce stade de la course");
        // Le chauffeur est facultatif (location sans chauffeur), l'immatriculation non.
        if (to === "ONGOING" && (await prisma.tripVehicle.count({ where: { tripId: id, unitId: null } })) > 0) {
          throw new HttpError(400, "Attribuez une immatriculation à chaque véhicule avant le départ");
        }
        if (to === "CANCELLED" && !data.reason) throw new HttpError(400, "Indiquez le motif de l'annulation");
        return prisma.trip.update({ where: { id }, data: tripStatusUpdate(trip, to, data.reason), include: tripInclude });
      },
      { partial: true },
    ),
  );

  router.patch(
    "/trips/:id",
    write(
      tripEditInput,
      async (data, id, res) => {
        const trip = await ownTrip(id, res);
        const editable = trip.status === "PENDING" || trip.status === "CONFIRMED";
        if (data.driverId) await ownDriver(data.driverId, res);
        if (data.units) {
          for (const u of data.units) {
            const line = await prisma.tripVehicle.findFirst({ where: { id: u.tripVehicleId, tripId: id } });
            if (!line) throw new HttpError(404, "Ligne introuvable");
            if (u.unitId && !(await prisma.vehicleUnit.findFirst({ where: { id: u.unitId, vehicleId: line.vehicleId } }))) {
              throw new HttpError(400, "Ce véhicule n'appartient pas à cette ligne");
            }
            await prisma.tripVehicle.update({ where: { id: u.tripVehicleId }, data: { unitId: u.unitId } });
          }
        }
        if (data.driverId !== undefined || data.paymentStatus || data.scheduledAt !== undefined) {
          await prisma.trip.update({
            where: { id },
            data: {
              ...(data.driverId !== undefined && { driverId: data.driverId }),
              ...(data.paymentStatus && { paymentStatus: data.paymentStatus }),
              ...(data.scheduledAt !== undefined && editable && { scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null }),
            },
          });
        }
        if (data.duration !== undefined || data.extraFee !== undefined || data.extraDiscount !== undefined) {
          if (!editable) throw new HttpError(409, "La course a démarré : les montants ne peuvent plus changer");
          return repriceTrip(prisma, id, { duration: data.duration, extraFee: data.extraFee, extraDiscount: data.extraDiscount });
        }
        return prisma.trip.findUniqueOrThrow({ where: { id }, include: tripInclude });
      },
      { partial: true },
    ),
  );

  // --- Véhicules ---

  router.get("/vehicles", async (_req, res) => {
    res.json(
      await prisma.vehicle.findMany({
        where: { providerId: me(res) },
        orderBy: { createdAt: "desc" },
        include: { units: { orderBy: { plateNumber: "asc" } }, _count: { select: { tripVehicles: true } } },
      }),
    );
  });
  router.get("/vehicles/:id", async (req, res) => {
    const v = await prisma.vehicle.findFirst({ where: { id: req.params.id, providerId: me(res) }, include: { units: { orderBy: { plateNumber: "asc" } } } });
    if (!v) {
      res.status(404).json({ error: "Véhicule introuvable" });
      return;
    }
    res.json(v);
  });
  router.post(
    "/vehicles",
    write(vehicleInput.extend(unitsInput.shape), async (data, _id, res) => {
      const { units, ...vehicle } = data;
      if (vehicle.hourlyPrice === null && vehicle.dailyPrice === null && vehicle.perKmPrice === null) {
        throw new HttpError(400, "Indiquez au moins un tarif (heure, jour ou km)");
      }
      return prisma.vehicle.create({ data: { ...vehicle, providerId: me(res), units: { create: units } }, include: { units: true } });
    }),
  );
  router.patch(
    "/vehicles/:id",
    write(
      vehicleInput,
      async (data, id, res) => {
        await ownVehicle(id, res);
        return prisma.vehicle.update({ where: { id }, data, include: { units: true } });
      },
      { partial: true },
    ),
  );
  // Remplace les immatriculations ; une unité déjà utilisée par une course est désactivée plutôt que supprimée.
  router.put(
    "/vehicles/:id/units",
    write(unitsInput, async (data, id, res) => {
      await ownVehicle(id, res);
      return prisma.$transaction(async (tx) => {
        const existing = await tx.vehicleUnit.findMany({ where: { vehicleId: id }, include: { _count: { select: { tripVehicles: true } } } });
        const wanted = new Map(data.units.map((u) => [u.plateNumber.toUpperCase(), u]));
        for (const u of existing) {
          const keep = wanted.get(u.plateNumber);
          if (keep) {
            await tx.vehicleUnit.update({ where: { id: u.id }, data: { active: true, vin: keep.vin } });
            wanted.delete(u.plateNumber);
          } else if (u._count.tripVehicles > 0) await tx.vehicleUnit.update({ where: { id: u.id }, data: { active: false } });
          else await tx.vehicleUnit.delete({ where: { id: u.id } });
        }
        for (const [plateNumber, u] of wanted) await tx.vehicleUnit.create({ data: { vehicleId: id, plateNumber, vin: u.vin } });
        return tx.vehicleUnit.findMany({ where: { vehicleId: id }, orderBy: { plateNumber: "asc" } });
      });
    }),
  );

  // --- Chauffeurs ---

  router.get("/drivers", async (_req, res) => {
    const drivers = await prisma.rentalDriver.findMany({ where: { providerId: me(res) }, orderBy: { firstName: "asc" } });
    const stats = await prisma.trip.groupBy({
      by: ["driverId", "status"],
      _count: { _all: true },
      where: { providerId: me(res), driverId: { in: drivers.map((d) => d.id) } },
    });
    const count = (id: string, status?: TripStatus) =>
      stats.filter((s) => s.driverId === id && (!status || s.status === status)).reduce((n, s) => n + s._count._all, 0);
    res.json(drivers.map((d) => ({ ...d, trips: count(d.id), completed: count(d.id, "COMPLETED"), cancelled: count(d.id, "CANCELLED") })));
  });
  router.post("/drivers", write(driverInput, (data, _id, res) => prisma.rentalDriver.create({ data: { ...data, providerId: me(res) } })));
  router.patch(
    "/drivers/:id",
    write(
      driverInput,
      async (data, id, res) => {
        await ownDriver(id, res);
        return prisma.rentalDriver.update({ where: { id }, data });
      },
      { partial: true },
    ),
  );

  // --- Réglages et relevés ---

  router.patch(
    "/settings",
    write(
      settingsInput,
      async (data, _id, res) => {
        if (data.pickupTimeMin !== undefined && data.pickupTimeMax !== undefined && data.pickupTimeMin > data.pickupTimeMax) {
          throw new HttpError(400, "Le délai minimum dépasse le maximum");
        }
        const p = await prisma.rentalProvider.update({ where: { id: me(res) }, data: { ...data, ...(data.temporarilyClosed === false ? { closedUntil: null } : {}) }, omit: { ownerPasswordHash: true, sessionsValidFrom: true } });
        return { ...p, availability: rentalAvailability(p) };
      },
      { partial: true },
    ),
  );

  router.get("/settlements", async (_req, res) => {
    const [settlements, pending] = await Promise.all([
      prisma.rentalSettlement.findMany({ where: { providerId: me(res) }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.trip.findMany({ where: { providerId: me(res), status: "COMPLETED", settlementId: null }, select: { total: true, commission: true } }),
    ]);
    const sales = pending.reduce((s, t) => s + t.total, 0);
    const commission = pending.reduce((s, t) => s + t.commission, 0);
    res.json({ settlements, pending: { trips: pending.length, sales, commission, amountDue: sales - commission } });
  });

  return router;
}
