import { type Response, Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import { moduleView, REQUEST_MODULES, MODULES } from "../services.js";
import {
  announceRequest,
  codesOf,
  DETAILS,
  estimateFor,
  isRequestModule,
  MAX_MISSIONS_PER_PROVIDER,
  MAX_OPEN_PER_CUSTOMER,
  MAX_PER_DAY,
  MAX_PER_MINUTE,
  parseDetails,
  REQUEST_OPEN,
  REQUEST_WITH_PROVIDER,
  requestCode,
  slotError,
  STATUS_LABEL,
  summaryOf,
  type RequestStatus,
} from "../serviceRequests.js";
import { staffName } from "../team.js";
import { firstError } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Demandes de service côté client (/api/customer/service-requests), prestataire (/api/livreur/missions) et
// admin (/api/admin/service-requests, /api/admin/service-providers).

function sendError(res: Response, e: unknown) {
  if (e instanceof HttpError) {
    res.status(e.status).json({ error: e.message });
    return;
  }
  throw e;
}

const reasonInput = z.object({ reason: z.string().trim().min(3, "Indiquez la raison").max(200) });
const moduleLabel = (code: string) => MODULES.find((m) => m.code === code)?.label ?? code;

const baseSelect = {
  id: true,
  code: true,
  module: true,
  status: true,
  address: true,
  latitude: true,
  longitude: true,
  details: true,
  summary: true,
  note: true,
  scheduledFor: true,
  estimate: true,
  extra: true,
  finalPrice: true,
  acceptedAt: true,
  onTheWayAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  cancelledBy: true,
  cancelReason: true,
  rating: true,
  ratingComment: true,
  createdAt: true,
} as const;

type Base = { details: string; status: string };
const withDetails = <T extends Base>(r: T) => ({ ...r, details: parseDetails(r.details), statusLabel: STATUS_LABEL[r.status as RequestStatus] ?? r.status });

// --- Client ---

const forCustomer = { ...baseSelect, customerId: true, provider: { select: { name: true, phone: true } } } as const;

export function serviceCustomerRoutes(router: Router, prisma: PrismaClient, notifier: Notifier) {
  // Numéro du prestataire : seulement pendant la mission.
  const view = (r: Awaited<ReturnType<typeof own>>) => {
    const { customerId: _c, provider, ...rest } = r;
    const live = (REQUEST_WITH_PROVIDER as readonly string[]).includes(r.status);
    return withDetails({ ...rest, provider: provider ? { name: provider.name, phone: live ? provider.phone : null } : null });
  };

  async function own(id: string, customerId: string) {
    const r = await prisma.serviceRequest.findUnique({ where: { id }, select: forCustomer });
    if (!r || r.customerId !== customerId) throw new HttpError(404, "Demande introuvable");
    return r;
  }

  router.post("/service-requests", async (req, res) => {
    const head = z
      .object({
        module: z.enum(REQUEST_MODULES, { errorMap: () => ({ message: "Service inconnu" }) }),
        address: z.string().trim().min(3, "Indiquez l'adresse").max(200),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
        note: z.string().trim().max(300).optional(),
        scheduledFor: z.string().datetime({ offset: true }).optional(),
        details: z.record(z.unknown()),
      })
      .safeParse(req.body);
    if (!head.success) {
      res.status(400).json({ error: firstError(head.error) });
      return;
    }
    const { module: code, address, latitude, longitude, note, scheduledFor } = head.data;
    if (!isRequestModule(code)) {
      res.status(400).json({ error: "Service inconnu" });
      return;
    }
    const details = DETAILS[code].safeParse(head.data.details);
    if (!details.success) {
      // Message du champ seul : le client voit « Choisissez gaz ou eau », pas le nom technique du champ.
      res.status(400).json({ error: details.error.issues[0]?.message ?? "Demande incomplète" });
      return;
    }
    const customerId: string = res.locals.customerId;
    const now = new Date();
    const slot = scheduledFor ? new Date(scheduledFor) : null;
    const badSlot = slotError(code, slot, now);
    if (badSlot) {
      res.status(400).json({ error: badSlot });
      return;
    }
    const module = await moduleView(prisma, code);
    if (!module || module.state !== "ON") {
      res.status(409).json({ error: `${moduleLabel(code)} : service fermé pour le moment.` });
      return;
    }
    const [open, lastMinute, today] = await Promise.all([
      prisma.serviceRequest.count({ where: { customerId, status: { in: [...REQUEST_OPEN] } } }),
      prisma.serviceRequest.count({ where: { customerId, createdAt: { gte: new Date(now.getTime() - 60_000) } } }),
      prisma.serviceRequest.count({ where: { customerId, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    ]);
    if (open >= MAX_OPEN_PER_CUSTOMER) {
      res.status(409).json({ error: "Vous avez déjà 3 demandes en cours. Attendez qu'une se termine." });
      return;
    }
    if (lastMinute >= MAX_PER_MINUTE || today >= MAX_PER_DAY) {
      res.status(429).json({ error: "Trop de demandes : patientez un instant." });
      return;
    }
    const data = details.data as never;
    let created = null;
    for (let attempt = 0; !created; attempt++) {
      try {
        created = await prisma.serviceRequest.create({
          data: {
            code: requestCode(),
            module: code,
            customerId,
            address,
            latitude: latitude ?? null,
            longitude: longitude ?? null,
            details: JSON.stringify(details.data),
            summary: summaryOf(code, data),
            note: note || null,
            scheduledFor: slot,
            estimate: estimateFor(module, code, data),
          },
          select: { id: true, code: true, module: true, summary: true, address: true },
        });
      } catch (e) {
        if (attempt >= 4 || (e as { code?: string }).code !== "P2002") throw e;
      }
    }
    await announceRequest(prisma, notifier, created);
    res.status(201).json(view(await own(created.id, customerId)));
  });

  router.get("/service-requests", async (_req, res) => {
    const customerId: string = res.locals.customerId;
    const rows = await prisma.serviceRequest.findMany({ where: { customerId }, orderBy: { createdAt: "desc" }, take: 30, select: forCustomer });
    res.json(rows.map(view));
  });

  router.get("/service-requests/:id", async (req, res) => {
    try {
      res.json(view(await own(String(req.params.id), res.locals.customerId)));
    } catch (e) {
      sendError(res, e);
    }
  });

  // Annuler : possible tant que le prestataire n'a pas commencé.
  router.post("/service-requests/:id/cancel", async (req, res) => {
    const reason = z.object({ reason: z.string().trim().max(200).optional() }).safeParse(req.body ?? {});
    try {
      const r = await own(String(req.params.id), res.locals.customerId);
      const { count } = await prisma.serviceRequest.updateMany({
        where: { id: r.id, status: { in: ["PENDING", "ACCEPTED", "ON_THE_WAY"] } },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "CUSTOMER", cancelReason: (reason.success && reason.data.reason) || null },
      });
      if (!count) throw new HttpError(409, r.status === "IN_PROGRESS" ? "Le prestataire a déjà commencé : appelez-le." : "Demande déjà close");
      const updated = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id }, select: { providerId: true } });
      if (r.provider && updated.providerId) {
        void notifier.push("driver", updated.providerId, { title: "Mission annulée", body: `${r.code} : le client a annulé.`, url: "/livreur/missions", tag: `sv-${r.id}` }).catch(() => {});
      }
      res.json(view(await own(r.id, res.locals.customerId)));
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/service-requests/:id/rate", async (req, res) => {
    const parsed = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(300).optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choisissez une note de 1 à 5" });
      return;
    }
    try {
      const r = await own(String(req.params.id), res.locals.customerId);
      const { count } = await prisma.serviceRequest.updateMany({ where: { id: r.id, status: "DONE", rating: null }, data: { rating: parsed.data.rating, ratingComment: parsed.data.comment || null } });
      if (!count) throw new HttpError(409, "Demande pas encore terminée, ou déjà notée");
      res.json(view(await own(r.id, res.locals.customerId)));
    } catch (e) {
      sendError(res, e);
    }
  });
}

// --- Livreur ou prestataire ---

const forProvider = { ...baseSelect, providerId: true, customerId: true, customer: { select: { name: true, phone: true } } } as const;

export function serviceProviderRoutes(router: Router, prisma: PrismaClient, notifier: Notifier) {
  async function codes(driverId: string) {
    const d = await prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { serviceCodes: true } });
    return codesOf(d.serviceCodes);
  }

  // Mission vue par le prestataire : nom et numéro du client seulement une fois la mission acceptée.
  const view = (r: { customer: { name: string | null; phone: string } } & Record<string, unknown> & Base, mine: boolean) => {
    const { customer, customerId: _c, providerId: _p, ...rest } = r;
    return withDetails({ ...rest, customer: mine ? { name: customer.name, phone: customer.phone } : null });
  };

  router.get("/missions", async (_req, res) => {
    const driverId: string = res.locals.driverId;
    const mine = await codes(driverId);
    const today = new Date(Date.now() - 86_400_000);
    const [available, active, done] = await Promise.all([
      mine.length
        ? prisma.serviceRequest.findMany({ where: { status: "PENDING", module: { in: mine } }, orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }], take: 30, select: forProvider })
        : Promise.resolve([]),
      prisma.serviceRequest.findMany({ where: { providerId: driverId, status: { in: [...REQUEST_WITH_PROVIDER] } }, orderBy: { acceptedAt: "asc" }, select: forProvider }),
      prisma.serviceRequest.findMany({ where: { providerId: driverId, status: "DONE", completedAt: { gte: today } }, orderBy: { completedAt: "desc" }, take: 10, select: forProvider }),
    ]);
    res.json({ codes: mine, available: available.map((r) => view(r, false)), active: active.map((r) => view(r, true)), done: done.map((r) => view(r, true)) });
  });

  async function ownMission(id: string, driverId: string) {
    const r = await prisma.serviceRequest.findUnique({ where: { id }, select: forProvider });
    if (!r || r.providerId !== driverId) throw new HttpError(404, "Mission introuvable");
    return r;
  }
  const reply = async (res: Response, id: string) => res.json(view(await prisma.serviceRequest.findUniqueOrThrow({ where: { id }, select: forProvider }), true));

  router.post("/missions/:id/accept", async (req, res) => {
    try {
      const driverId: string = res.locals.driverId;
      const r = await prisma.serviceRequest.findUnique({ where: { id: String(req.params.id) }, select: { id: true, code: true, module: true, customerId: true } });
      if (!r) throw new HttpError(404, "Mission introuvable");
      const [mine, busy, driver] = await Promise.all([
        codes(driverId),
        prisma.serviceRequest.count({ where: { providerId: driverId, status: { in: [...REQUEST_WITH_PROVIDER] } } }),
        prisma.driver.findUniqueOrThrow({ where: { id: driverId }, select: { name: true } }),
      ]);
      if (!mine.includes(r.module)) throw new HttpError(403, "Ce service n'est pas dans votre profil");
      if (busy >= MAX_MISSIONS_PER_PROVIDER) throw new HttpError(409, "Terminez d'abord vos missions en cours (3 au plus)");
      // Le premier qui accepte la prend : la mise à jour ne passe que si la demande attend encore.
      const { count } = await prisma.serviceRequest.updateMany({ where: { id: r.id, status: "PENDING", providerId: null }, data: { status: "ACCEPTED", providerId: driverId, acceptedAt: new Date() } });
      if (!count) throw new HttpError(409, "Mission déjà prise ou annulée");
      // Deux acceptations en même temps peuvent passer le premier contrôle : on recompte et on rend celle-ci.
      const after = await prisma.serviceRequest.count({ where: { providerId: driverId, status: { in: [...REQUEST_WITH_PROVIDER] } } });
      if (after > MAX_MISSIONS_PER_PROVIDER) {
        await prisma.serviceRequest.updateMany({ where: { id: r.id, providerId: driverId, status: "ACCEPTED" }, data: { status: "PENDING", providerId: null, acceptedAt: null } });
        throw new HttpError(409, "Terminez d'abord vos missions en cours (3 au plus)");
      }
      void notifier.push("customer", r.customerId, { title: "Prestataire trouvé", body: `${driver.name} s'occupe de votre demande ${r.code}.`, url: `/app/services/demande/${r.id}`, tag: `sv-${r.id}` }).catch(() => {});
      await reply(res, r.id);
    } catch (e) {
      sendError(res, e);
    }
  });

  // Étapes : en route, puis sur place (travail commencé).
  router.post("/missions/:id/step", async (req, res) => {
    const parsed = z.object({ status: z.enum(["ON_THE_WAY", "IN_PROGRESS"]) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Étape inconnue" });
      return;
    }
    try {
      const r = await ownMission(String(req.params.id), res.locals.driverId);
      const next = parsed.data.status;
      const from = next === "ON_THE_WAY" ? ["ACCEPTED"] : ["ACCEPTED", "ON_THE_WAY"];
      const now = new Date();
      const { count } = await prisma.serviceRequest.updateMany({
        where: { id: r.id, status: { in: from } },
        data: next === "ON_THE_WAY" ? { status: next, onTheWayAt: now } : { status: next, startedAt: now, onTheWayAt: r.onTheWayAt ?? now },
      });
      if (!count) throw new HttpError(409, "Étape déjà passée ou mission close");
      const body = next === "ON_THE_WAY" ? "Votre prestataire est en route." : "Votre prestataire a commencé.";
      void notifier.push("customer", r.customerId, { title: moduleLabel(r.module), body, url: `/app/services/demande/${r.id}`, tag: `sv-${r.id}` }).catch(() => {});
      await reply(res, r.id);
    } catch (e) {
      sendError(res, e);
    }
  });

  // Fin de mission : achats, produits ou pièces payés par le prestataire, ajoutés au prix estimé.
  router.post("/missions/:id/complete", async (req, res) => {
    const parsed = z.object({ extra: z.number().int().min(0).max(500_000).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Montant invalide (500 000 FCFA au plus)" });
      return;
    }
    try {
      const r = await ownMission(String(req.params.id), res.locals.driverId);
      const extra = parsed.data.extra ?? 0;
      const now = new Date();
      const { count } = await prisma.serviceRequest.updateMany({
        where: { id: r.id, status: { in: [...REQUEST_WITH_PROVIDER] } },
        data: { status: "DONE", completedAt: now, startedAt: r.startedAt ?? now, extra, finalPrice: r.estimate + extra },
      });
      if (!count) throw new HttpError(409, "Mission déjà close");
      void notifier
        .push("customer", r.customerId, { title: `${moduleLabel(r.module)} terminé`, body: `Total : ${(r.estimate + extra).toLocaleString("fr-FR")} FCFA. Notez votre prestataire.`, url: `/app/services/demande/${r.id}`, tag: `sv-${r.id}` })
        .catch(() => {});
      await reply(res, r.id);
    } catch (e) {
      sendError(res, e);
    }
  });

  // Le prestataire ne peut plus venir : la demande repart aux autres.
  router.post("/missions/:id/release", async (req, res) => {
    const parsed = reasonInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const r = await ownMission(String(req.params.id), res.locals.driverId);
      const { count } = await prisma.serviceRequest.updateMany({
        where: { id: r.id, status: { in: ["ACCEPTED", "ON_THE_WAY"] } },
        data: { status: "PENDING", providerId: null, acceptedAt: null, onTheWayAt: null, cancelReason: `Prestataire : ${parsed.data.reason}` },
      });
      if (!count) throw new HttpError(409, "Travail commencé : terminez la mission");
      void notifier.push("customer", r.customerId, { title: "Nouveau prestataire recherché", body: "Votre prestataire ne peut pas venir. Nous en cherchons un autre.", url: `/app/services/demande/${r.id}`, tag: `sv-${r.id}` }).catch(() => {});
      await announceRequest(prisma, notifier, { id: r.id, code: r.code, module: r.module, summary: r.summary, address: r.address });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e);
    }
  });
}

// Compteurs pour l'accueil du livreur (/current) : services du profil, missions qui attendent, missions en cours.
export async function missionsSummary(prisma: PrismaClient, driverId: string, serviceCodes: string | null | undefined) {
  const mine = codesOf(serviceCodes);
  if (!mine.length) return null;
  const [available, active] = await Promise.all([
    prisma.serviceRequest.count({ where: { status: "PENDING", module: { in: mine } } }),
    prisma.serviceRequest.count({ where: { providerId: driverId, status: { in: [...REQUEST_WITH_PROVIDER] } } }),
  ]);
  return { codes: mine, available, active };
}

// --- Admin ---

const forAdmin = { ...baseSelect, customer: { select: { name: true, phone: true } }, provider: { select: { id: true, name: true, phone: true } } } as const;
const codesInput = z.object({ codes: z.array(z.enum(REQUEST_MODULES)).max(REQUEST_MODULES.length) });

export function adminServiceRequestsRouter(prisma: PrismaClient, notifier: Notifier) {
  const router = Router();

  async function providers() {
    const drivers = await prisma.driver.findMany({
      where: { deletedAt: null, status: "APPROVED" },
      orderBy: { name: "asc" },
      take: 500,
      select: { id: true, name: true, phone: true, active: true, serviceCodes: true, _count: { select: { serviceRequests: { where: { status: { in: [...REQUEST_WITH_PROVIDER] } } } } } },
    });
    return drivers.map(({ _count, serviceCodes, ...d }) => ({ ...d, codes: codesOf(serviceCodes), busy: _count.serviceRequests }));
  }

  router.get("/service-requests", async (req, res) => {
    const q = z
      .object({ status: z.enum(["open", "done", "cancelled", "all"]).default("open"), module: z.enum(REQUEST_MODULES).optional() })
      .safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: "Filtre invalide" });
      return;
    }
    const { status, module } = q.data;
    const where = {
      ...(module ? { module } : {}),
      ...(status === "open" ? { status: { in: [...REQUEST_OPEN] } } : status === "done" ? { status: "DONE" } : status === "cancelled" ? { status: "CANCELLED" } : {}),
    };
    const [rows, counts, list] = await Promise.all([
      prisma.serviceRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, select: forAdmin }),
      prisma.serviceRequest.groupBy({ by: ["status"], _count: { _all: true } }),
      providers(),
    ]);
    res.json({
      requests: rows.map(withDetails),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      providers: list.filter((p) => p.codes.length),
    });
  });

  // Attribuer (ou réattribuer) une demande à un prestataire qui fait ce service.
  router.post("/service-requests/:id/assign", async (req, res) => {
    const parsed = z.object({ providerId: z.string().min(1, "Choisissez un prestataire") }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const r = await prisma.serviceRequest.findUnique({ where: { id: String(req.params.id) }, select: { id: true, code: true, module: true, status: true, customerId: true, providerId: true, summary: true, address: true } });
      if (!r) throw new HttpError(404, "Demande introuvable");
      const p = await prisma.driver.findUnique({ where: { id: parsed.data.providerId }, select: { id: true, name: true, serviceCodes: true, status: true, active: true, deletedAt: true } });
      if (!p || p.deletedAt || p.status !== "APPROVED") throw new HttpError(404, "Prestataire introuvable");
      if (!codesOf(p.serviceCodes).includes(r.module)) throw new HttpError(400, `${p.name} ne fait pas ce service : ajoutez-le à son profil d'abord`);
      const { count } = await prisma.serviceRequest.updateMany({
        where: { id: r.id, status: { in: ["PENDING", "ACCEPTED", "ON_THE_WAY"] } },
        data: { status: "ACCEPTED", providerId: p.id, acceptedAt: new Date(), onTheWayAt: null },
      });
      if (!count) throw new HttpError(409, "Demande déjà commencée ou close");
      if (r.providerId && r.providerId !== p.id) {
        void notifier.push("driver", r.providerId, { title: "Mission retirée", body: `${r.code} a été confiée à un autre prestataire.`, url: "/livreur/missions", tag: `sv-${r.id}` }).catch(() => {});
      }
      void notifier.push("driver", p.id, { title: "Mission pour vous", body: `${r.summary} · ${r.address}`, url: "/livreur/missions", tag: `sv-${r.id}`, alarm: true }).catch(() => {});
      void notifier.push("customer", r.customerId, { title: "Prestataire trouvé", body: `${p.name} s'occupe de votre demande ${r.code}.`, url: `/app/services/demande/${r.id}`, tag: `sv-${r.id}` }).catch(() => {});
      res.json(withDetails(await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id }, select: forAdmin })));
    } catch (e) {
      sendError(res, e);
    }
  });

  router.post("/service-requests/:id/cancel", async (req, res) => {
    const parsed = reasonInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const r = await prisma.serviceRequest.findUnique({ where: { id: String(req.params.id) }, select: { id: true, code: true, customerId: true, providerId: true } });
      if (!r) throw new HttpError(404, "Demande introuvable");
      const { count } = await prisma.serviceRequest.updateMany({
        where: { id: r.id, status: { in: [...REQUEST_OPEN] } },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelledBy: "STAFF", cancelReason: `${parsed.data.reason}${staffName(res) ? ` (${staffName(res)})` : ""}` },
      });
      if (!count) throw new HttpError(409, "Demande déjà close");
      void notifier.push("customer", r.customerId, { title: "Demande annulée", body: `${r.code} : ${parsed.data.reason}`, url: `/app/services/demande/${r.id}`, tag: `sv-${r.id}` }).catch(() => {});
      if (r.providerId) void notifier.push("driver", r.providerId, { title: "Mission annulée", body: `${r.code} a été annulée par Zedeka.`, url: "/livreur/missions", tag: `sv-${r.id}` }).catch(() => {});
      res.json(withDetails(await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id }, select: forAdmin })));
    } catch (e) {
      sendError(res, e);
    }
  });

  // Livreurs et prestataires, avec les services que chacun fait.
  router.get("/service-providers", async (_req, res) => {
    res.json(await providers());
  });

  router.patch("/service-providers/:id", async (req, res) => {
    const parsed = codesInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Services inconnus" });
      return;
    }
    const id = String(req.params.id);
    const driver = await prisma.driver.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!driver || driver.deletedAt) {
      res.status(404).json({ error: "Livreur introuvable" });
      return;
    }
    const codes = REQUEST_MODULES.filter((c) => parsed.data.codes.includes(c));
    await prisma.driver.update({ where: { id }, data: { serviceCodes: codes.join(",") } });
    res.json((await providers()).find((p) => p.id === id));
  });

  return router;
}
