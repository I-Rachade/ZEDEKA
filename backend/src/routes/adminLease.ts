import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { plateInput } from "../driverDocuments.js";
import {
  LEASE_KINDS,
  contractWithPayments,
  leaseBalance,
  leaseEligibilityError,
  leasingPerDay,
  notifyLeasePaid,
  parseStartDate,
  type LeaseKind,
} from "../lease.js";
import type { Notifier } from "../notify.js";
import { staffName } from "../team.js";
import { formatFcfa } from "../pricing.js";
import { firstError, getSettings } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Admin : leasing de motos aux livreurs indépendants (src/lease.ts). Contrats, compte de chaque livreur, paiements
// mobile money à confirmer et espèces encaissées au bureau. Réservé au directeur et à l'administrateur adjoint.

const driverBrief = { select: { id: true, name: true, phone: true, online: true, zedStatus: true, deliveries: true } } as const;

const createInput = z.object({
  driverId: z.string().min(1, "Choisissez un livreur"),
  kind: z.enum(LEASE_KINDS, { errorMap: () => ({ message: "Choisissez le type de moto" }) }),
  plate: plateInput,
  label: z.string().trim().max(80).nullish(),
  startsAt: z.string().trim().max(10).optional(),
  dailyRate: z.number().int().min(0).max(100_000).optional(),
  deposit: z.number().int().min(0).max(10_000_000).nullish(),
  note: z.string().trim().max(300).nullish(),
});

const editInput = z.object({
  plate: plateInput.optional(),
  label: z.string().trim().max(80).nullish(),
  deposit: z.number().int().min(0).max(10_000_000).nullish(),
  note: z.string().trim().max(300).nullish(),
});

const fail = (res: import("express").Response, e: unknown) => {
  if (!(e instanceof HttpError)) throw e;
  res.status(e.status).json({ error: e.message });
};

export function adminLeaseRouter(prisma: PrismaClient, config: { notifier: Notifier }) {
  const router = Router();
  const { notifier } = config;

  // Chiffres de la page : contrats en cours, en retard, paiements à confirmer, revenu par jour, encaissé ce mois-ci.
  router.get("/leases/summary", async (_req, res) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [active, pending, month, s] = await Promise.all([
      prisma.leaseContract.findMany({ where: { status: "ACTIVE" }, include: contractWithPayments }),
      prisma.leasePayment.count({ where: { status: "PENDING" } }),
      prisma.leasePayment.aggregate({ _sum: { amount: true }, where: { status: "CONFIRMED", reviewedAt: { gte: monthStart } } }),
      getSettings(prisma),
    ]);
    const balances = active.map((c) => leaseBalance(c, c.payments, now));
    res.json({
      active: active.length,
      home: active.filter((c) => c.kind === "HOME").length,
      zedeka: active.filter((c) => c.kind === "ZEDEKA").length,
      late: balances.filter((b) => b.state === "LATE").length,
      owed: balances.reduce((sum, b) => sum + b.owed, 0),
      pendingPayments: pending,
      perDay: leasingPerDay(active),
      collectedThisMonth: month._sum.amount ?? 0,
      rates: { HOME: s.leaseHomeRate, ZEDEKA: s.leaseZedekaRate },
      blockDays: s.leaseBlockDays,
    });
  });

  // Contrats : en cours (par défaut), terminés, ou ceux d'un livreur (fiche livreur).
  router.get("/leases", async (req, res) => {
    const now = new Date();
    const driverId = typeof req.query.driverId === "string" ? req.query.driverId : undefined;
    const status = z.enum(["ACTIVE", "ENDED"]).catch("ACTIVE").parse(req.query.status);
    const rows = await prisma.leaseContract.findMany({
      where: driverId ? { driverId } : { status },
      orderBy: { createdAt: "desc" },
      take: 300,
      include: { ...contractWithPayments, driver: driverBrief },
    });
    const list = rows.map(({ payments, remindedOn: _r, ...c }) => ({ ...c, balance: leaseBalance(c, payments, now) }));
    // En retard d'abord, puis ce qui reste à payer.
    if (!driverId) list.sort((a, b) => b.balance.lateDays - a.balance.lateDays || b.balance.owed - a.balance.owed);
    res.json(list);
  });

  // Livreurs à qui une moto peut être louée : validés, indépendants, sans contrat en cours.
  router.get("/leases/drivers", async (_req, res) => {
    res.json(
      await prisma.driver.findMany({
        where: { status: "APPROVED", deletedAt: null, employment: "FREELANCE", leaseContracts: { none: { status: "ACTIVE" } } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, phone: true, plate: true, zedStatus: true, deliveries: true },
      }),
    );
  });

  router.post("/leases", async (req, res) => {
    const parsed = createInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const d = parsed.data;
      const problem = await leaseEligibilityError(prisma, d.driverId, d.plate);
      if (problem) throw new HttpError(409, problem);
      const s = await getSettings(prisma);
      const dailyRate = d.dailyRate ?? (d.kind === "HOME" ? s.leaseHomeRate : s.leaseZedekaRate);
      const contract = await prisma.leaseContract.create({
        data: {
          driverId: d.driverId,
          kind: d.kind satisfies LeaseKind,
          plate: d.plate,
          label: d.label || null,
          dailyRate,
          startsAt: parseStartDate(d.startsAt),
          deposit: d.deposit ?? null,
          note: d.note || null,
          createdBy: staffName(res) ?? "Direction",
        },
      });
      // La plaque du livreur devient celle de la moto louée (page de suivi, écran Zed du client).
      await prisma.driver.update({ where: { id: d.driverId }, data: { plate: d.plate } });
      await notifier
        .push("driver", d.driverId, {
          title: "Votre moto en leasing",
          body: `Contrat ouvert pour la moto ${d.plate} : ${formatFcfa(dailyRate)} par jour. Suivez vos paiements dans « Ma moto ».`,
          url: "/livreur/moto",
          tag: `lease-${contract.id}`,
        })
        .catch(() => {});
      res.status(201).json(contract);
    } catch (e) {
      fail(res, e);
    }
  });

  router.get("/leases/:id", async (req, res) => {
    const c = await prisma.leaseContract.findUnique({
      where: { id: String(req.params.id) },
      include: { driver: driverBrief, payments: { orderBy: { createdAt: "desc" } } },
    });
    if (!c) {
      res.status(404).json({ error: "Contrat introuvable" });
      return;
    }
    const { remindedOn: _r, ...rest } = c;
    res.json({ ...rest, balance: leaseBalance(c, c.payments) });
  });

  // Plaque, modèle, caution, remarque. Le prix par jour reste celui de la signature (il compte pour tout le passé).
  router.patch("/leases/:id", async (req, res) => {
    const parsed = editInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    try {
      const id = String(req.params.id);
      const c = await prisma.leaseContract.findUnique({ where: { id }, select: { driverId: true, status: true, plate: true } });
      if (!c) throw new HttpError(404, "Contrat introuvable");
      const { plate, ...rest } = parsed.data;
      if (plate && plate !== c.plate && c.status === "ACTIVE" && (await prisma.leaseContract.count({ where: { plate, status: "ACTIVE" } })) > 0)
        throw new HttpError(409, "Cette plaque est déjà louée à un autre livreur");
      const updated = await prisma.leaseContract.update({
        where: { id },
        data: { ...(plate ? { plate } : {}), ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v === "" ? null : v])) },
      });
      if (plate && c.status === "ACTIVE") await prisma.driver.update({ where: { id: c.driverId }, data: { plate } });
      res.json(updated);
    } catch (e) {
      fail(res, e);
    }
  });

  // Moto rendue : contrat terminé. Les jours dus restent à payer (ils apparaissent toujours sur le contrat).
  router.post("/leases/:id/end", async (req, res) => {
    const parsed = z.object({ reason: z.string().trim().max(300).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const id = String(req.params.id);
    const now = new Date();
    const { count } = await prisma.leaseContract.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now, endReason: parsed.data.reason || null } });
    if (!count) {
      res.status(409).json({ error: "Ce contrat est déjà terminé" });
      return;
    }
    const c = await prisma.leaseContract.findUniqueOrThrow({ where: { id }, include: contractWithPayments });
    // Les paiements encore à confirmer restent à traiter ; la moto rendue ne bloque plus la mise en ligne.
    res.json({ ...c, balance: leaseBalance(c, c.payments, now) });
  });

  // Espèces reçues au bureau : enregistrées et confirmées tout de suite.
  router.post("/leases/:id/payments", async (req, res) => {
    const parsed = z
      .object({
        amount: z.number().int().min(1, "Indiquez le montant reçu").max(10_000_000),
        note: z.string().trim().max(300).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const id = String(req.params.id);
    const c = await prisma.leaseContract.findUnique({ where: { id }, select: { id: true, driverId: true, dailyRate: true } });
    if (!c) {
      res.status(404).json({ error: "Contrat introuvable" });
      return;
    }
    const now = new Date();
    const payment = await prisma.leasePayment.create({
      data: {
        contractId: c.id,
        driverId: c.driverId,
        amount: parsed.data.amount,
        days: Math.floor(parsed.data.amount / Math.max(1, c.dailyRate)),
        method: "CASH",
        status: "CONFIRMED",
        reviewedAt: now,
        reviewedBy: staffName(res) ?? "Direction",
        note: parsed.data.note || null,
      },
    });
    await notifyLeasePaid(prisma, notifier, c.id, now);
    res.status(201).json(payment);
  });

  // Paiements mobile money envoyés depuis l'appli livreur.
  router.get("/lease-payments", async (req, res) => {
    const status = z.enum(["PENDING", "CONFIRMED", "REJECTED"]).catch("PENDING").parse(req.query.status);
    res.json(
      await prisma.leasePayment.findMany({
        where: { status },
        orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" },
        take: 100,
        include: { driver: { select: { id: true, name: true, phone: true } }, contract: { select: { id: true, plate: true, kind: true, dailyRate: true } } },
      }),
    );
  });

  // Référence vérifiée sur le relevé mobile money : confirmée (le compte du livreur avance) ou refusée.
  router.post("/lease-payments/:id/review", async (req, res) => {
    const parsed = z.object({ decision: z.enum(["CONFIRM", "REJECT"]), note: z.string().trim().max(300).optional() }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const p = await prisma.leasePayment.findUnique({ where: { id: String(req.params.id) } });
    const now = new Date();
    const confirm = parsed.data.decision === "CONFIRM";
    // Deux validations en même temps (double clic, deux membres de l'équipe) : une seule passe.
    const { count } = p
      ? await prisma.leasePayment.updateMany({
          where: { id: p.id, status: "PENDING" },
          data: { status: confirm ? "CONFIRMED" : "REJECTED", reviewedAt: now, reviewedBy: staffName(res) ?? "Direction", note: parsed.data.note || null },
        })
      : { count: 0 };
    if (!p || !count) {
      res.status(409).json({ error: "Paiement déjà traité" });
      return;
    }
    if (confirm) await notifyLeasePaid(prisma, notifier, p.contractId, now);
    else
      await notifier
        .push("driver", p.driverId, { title: "Paiement de leasing non retrouvé", body: parsed.data.note || "Vérifiez la référence ou contactez Zedeka.", url: "/livreur/moto", tag: `lease-${p.contractId}` })
        .catch(() => {});
    res.json({ ok: true });
  });

  return router;
}
