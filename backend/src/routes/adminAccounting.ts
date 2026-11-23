import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ACCOUNT_KINDS, CATEGORIES, DIRECTIONS, accountBalances, categoryFits, journalTotals, periodOf } from "../accounting.js";
import { csvFile, dayField, monthOf, parseDay, parseMonth } from "../hr.js";
import { zedekaRevenue } from "../stats.js";
import { staffName } from "../team.js";
import { firstError, sendPrismaError } from "../util.js";
import { HttpError } from "./adminWrite.js";

// Admin : comptabilité (src/accounting.ts). Comptes de trésorerie, journal des recettes et dépenses (jamais effacé :
// une erreur s'annule avec son motif), virements entre comptes, paiement des salaires validés par les RH, chiffres
// de la plateforme sur une période (commandes, abonnements, leasing, Zed, espèces, reversements) et exports CSV.
// Ouvert au comptable et au directeur ; l'administrateur adjoint le consulte (voir team.ts).

const text = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const amount = z.number().int().min(1, "Montant : 1 FCFA minimum").max(10_000_000_000);

const accountInput = z.object({
  name: z.string().trim().min(2, "Nom du compte : 2 caractères minimum").max(80),
  kind: z.enum(ACCOUNT_KINDS),
  number: text(80),
  openingBalance: z.number().int().min(-10_000_000_000).max(10_000_000_000).default(0),
  active: z.boolean().default(true),
});

const entryInput = z.object({
  date: z.string().transform((v, ctx) => parseDay(v.trim()) ?? (ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date invalide (AAAA-MM-JJ)" }), z.NEVER)),
  direction: z.enum(DIRECTIONS),
  category: z.enum(CATEGORIES),
  amount,
  accountId: z.string().trim().max(60).nullish().transform((v) => v || null),
  label: z.string().trim().min(2, "Libellé : 2 caractères minimum").max(160),
  reference: text(80),
  counterparty: text(120),
});

// Après coup, seuls le libellé, la catégorie, la référence et le tiers se corrigent : une erreur de montant,
// de date ou de compte s'annule et se saisit à nouveau (trace gardée).
const entryEdit = z.object({ category: z.enum(CATEGORIES).optional(), label: z.string().trim().min(2).max(160).optional(), reference: text(80), counterparty: text(120) });

const transferInput = z.object({
  date: entryInput.shape.date,
  fromAccountId: z.string().min(1, "Choisissez le compte de départ"),
  toAccountId: z.string().min(1, "Choisissez le compte d'arrivée"),
  amount,
  label: text(160),
});

const fail = (res: Response, e: unknown) => {
  if (e instanceof HttpError) return void res.status(e.status).json({ error: e.message });
  if (!sendPrismaError(e, res)) throw e;
};

function parse<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, firstError(parsed.error));
  return parsed.data;
}

function periodFrom(req: Request) {
  const from = req.query.from === undefined ? null : parseDay(req.query.from);
  const to = req.query.to === undefined ? null : parseDay(req.query.to);
  if ((req.query.from !== undefined && !from) || (req.query.to !== undefined && !to)) throw new HttpError(400, "Date invalide (AAAA-MM-JJ)");
  const p = periodOf(from, to);
  if (!p) throw new HttpError(400, "Période invalide (deux ans au plus)");
  return p;
}

const entryInclude = { account: { select: { id: true, name: true, kind: true } } } as const;

export function adminAccountingRouter(prisma: PrismaClient) {
  const router = Router();
  const who = (res: Response) => staffName(res) ?? "Direction";

  async function balances() {
    const [accounts, entries] = await Promise.all([
      prisma.financeAccount.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
      prisma.ledgerEntry.findMany({ where: { voidedAt: null, accountId: { not: null } }, select: { direction: true, category: true, amount: true, accountId: true, voidedAt: true } }),
    ]);
    return accountBalances(accounts, entries);
  }

  async function activeAccount(id: string | null) {
    if (!id) return;
    const account = await prisma.financeAccount.findUnique({ where: { id }, select: { active: true } });
    if (!account) throw new HttpError(404, "Compte introuvable");
    if (!account.active) throw new HttpError(409, "Ce compte est fermé");
  }

  // ---------------------------------------------------------------- Comptes de trésorerie

  router.get("/accounting/accounts", async (_req, res) => {
    res.json(await balances());
  });

  router.post("/accounting/accounts", async (req, res) => {
    try {
      res.status(201).json(await prisma.financeAccount.create({ data: parse(accountInput, req.body) }));
    } catch (e) {
      fail(res, e);
    }
  });

  router.patch("/accounting/accounts/:id", async (req, res) => {
    try {
      res.json(await prisma.financeAccount.update({ where: { id: String(req.params.id) }, data: parse(accountInput.partial(), req.body) }));
    } catch (e) {
      fail(res, e);
    }
  });

  // ---------------------------------------------------------------- Journal

  const entryFilters = z.object({
    accountId: z.string().max(60).optional().catch(undefined),
    category: z.enum(CATEGORIES).optional().catch(undefined),
    direction: z.enum(DIRECTIONS).optional().catch(undefined),
    q: z.string().trim().max(80).optional().catch(undefined),
    voided: z.enum(["0", "1"]).catch("0"),
  });

  async function entriesOf(req: Request, take = 1000) {
    const p = periodFrom(req);
    const f = entryFilters.parse(req.query);
    const rows = await prisma.ledgerEntry.findMany({
      where: {
        date: { gte: p.start, lt: p.end },
        ...(f.accountId ? { accountId: f.accountId } : {}),
        ...(f.category ? { category: f.category } : {}),
        ...(f.direction ? { direction: f.direction } : {}),
        ...(f.q ? { OR: [{ label: { contains: f.q } }, { reference: { contains: f.q } }, { counterparty: { contains: f.q } }] } : {}),
        ...(f.voided === "1" ? {} : { voidedAt: null }),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take,
      include: entryInclude,
    });
    return { period: p, rows };
  }

  router.get("/accounting/entries", async (req, res) => {
    try {
      const { period, rows } = await entriesOf(req);
      res.json({ period, entries: rows, totals: journalTotals(rows) });
    } catch (e) {
      fail(res, e);
    }
  });

  router.post("/accounting/entries", async (req, res) => {
    try {
      const data = parse(entryInput, req.body);
      if (data.category === "TRANSFER") throw new HttpError(400, "Pour un virement entre deux comptes, utilisez « Virement »");
      if (!categoryFits(data.direction, data.category)) throw new HttpError(400, data.direction === "IN" ? "Cette catégorie est une dépense" : "Cette catégorie est une recette");
      await activeAccount(data.accountId);
      res.status(201).json(await prisma.ledgerEntry.create({ data: { ...data, source: "MANUAL", createdBy: who(res) }, include: entryInclude }));
    } catch (e) {
      fail(res, e);
    }
  });

  router.patch("/accounting/entries/:id", async (req, res) => {
    try {
      const data = parse(entryEdit, req.body);
      const entry = await prisma.ledgerEntry.findUnique({ where: { id: String(req.params.id) } });
      if (!entry) throw new HttpError(404, "Écriture introuvable");
      if (entry.voidedAt) throw new HttpError(409, "Écriture annulée");
      if (data.category && (entry.category === "TRANSFER" || data.category === "TRANSFER" || !categoryFits(entry.direction as "IN" | "OUT", data.category))) {
        throw new HttpError(400, "Catégorie impossible pour cette écriture");
      }
      res.json(await prisma.ledgerEntry.update({ where: { id: entry.id }, data, include: entryInclude }));
    } catch (e) {
      fail(res, e);
    }
  });

  // Annuler une écriture (avec son motif). Un virement s'annule en entier (ses deux écritures) ; un salaire payé
  // rouvre son bulletin (il redevient « validé », à payer).
  router.post("/accounting/entries/:id/void", async (req, res) => {
    try {
      const { reason } = parse(z.object({ reason: z.string().trim().min(3, "Indiquez le motif de l'annulation").max(300) }), req.body);
      const entry = await prisma.ledgerEntry.findUnique({ where: { id: String(req.params.id) } });
      if (!entry) throw new HttpError(404, "Écriture introuvable");
      const stamp = { voidedAt: new Date(), voidedBy: who(res), voidReason: reason };
      const where = entry.source === "TRANSFER" && entry.sourceId ? { source: "TRANSFER", sourceId: entry.sourceId, voidedAt: null } : { id: entry.id, voidedAt: null };
      const { count } = await prisma.ledgerEntry.updateMany({ where, data: stamp });
      if (count === 0) throw new HttpError(409, "Écriture déjà annulée");
      if (entry.source === "PAYROLL" && entry.sourceId) {
        await prisma.payslip.updateMany({ where: { id: entry.sourceId, status: "PAID", ledgerEntryId: entry.id }, data: { status: "VALIDATED", paidAt: null, paidBy: null, ledgerEntryId: null } });
      }
      res.json(await prisma.ledgerEntry.findUnique({ where: { id: entry.id }, include: entryInclude }));
    } catch (e) {
      fail(res, e);
    }
  });

  // Virement entre deux comptes de Zedeka (ex. dépôt de la caisse à la banque) : deux écritures liées.
  router.post("/accounting/transfers", async (req, res) => {
    try {
      const data = parse(transferInput, req.body);
      if (data.fromAccountId === data.toAccountId) throw new HttpError(400, "Choisissez deux comptes différents");
      await Promise.all([activeAccount(data.fromAccountId), activeAccount(data.toAccountId)]);
      const sourceId = crypto.randomUUID();
      const label = data.label ?? "Virement entre comptes";
      const base = { date: data.date, category: "TRANSFER", amount: data.amount, label, source: "TRANSFER", sourceId, createdBy: who(res) };
      await prisma.ledgerEntry.create({ data: { ...base, direction: "OUT", accountId: data.fromAccountId } });
      await prisma.ledgerEntry.create({ data: { ...base, direction: "IN", accountId: data.toAccountId } });
      res.status(201).json(await balances());
    } catch (e) {
      fail(res, e);
    }
  });

  router.get("/accounting/export", async (req, res) => {
    try {
      const { period, rows } = await entriesOf(req, 20_000);
      const lines = [
        ["Date", "Sens", "Catégorie", "Libellé", "Montant (FCFA)", "Compte", "Référence", "Tiers", "Origine", "Saisi par", "Annulée le", "Motif d'annulation"],
        ...rows
          .slice()
          .reverse()
          .map((e) => [
            e.date.toISOString().slice(0, 10),
            e.direction === "IN" ? "Recette" : "Dépense",
            e.category,
            e.label,
            e.direction === "IN" ? e.amount : -e.amount,
            e.account?.name ?? "",
            e.reference ?? "",
            e.counterparty ?? "",
            e.source,
            e.createdBy ?? "",
            e.voidedAt ? e.voidedAt.toISOString().slice(0, 10) : "",
            e.voidReason ?? "",
          ]),
      ];
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", `attachment; filename="journal-${period.from}-${period.to}.csv"`);
      res.send(csvFile(lines));
    } catch (e) {
      fail(res, e);
    }
  });

  // ---------------------------------------------------------------- Paie (paiement des bulletins validés par les RH)

  router.get("/accounting/payroll", async (req, res) => {
    const month = parseMonth(req.query.month) ?? parseMonth(monthOf(new Date()))!;
    const slips = await prisma.payslip.findMany({
      where: { month: month.month, status: { in: ["VALIDATED", "PAID"] } },
      orderBy: { employee: { name: "asc" } },
      select: {
        id: true,
        month: true,
        net: true,
        status: true,
        validatedBy: true,
        paidAt: true,
        paidBy: true,
        ledgerEntryId: true,
        employee: { select: { id: true, name: true, position: true, paymentMethod: true, paymentAccount: true } },
      },
    });
    const drafts = await prisma.payslip.count({ where: { month: month.month, status: "DRAFT" } });
    res.json({
      month: month.month,
      payslips: slips,
      drafts,
      toPay: slips.filter((p) => p.status === "VALIDATED").reduce((s, p) => s + p.net, 0),
      paid: slips.filter((p) => p.status === "PAID").reduce((s, p) => s + p.net, 0),
    });
  });

  const payInput = z.object({ accountId: z.string().min(1, "Choisissez le compte qui paie"), date: dayField.optional(), reference: text(80) });

  // Payer un bulletin : il passe « payé » (une seule fois, même avec deux clics) et une dépense « Salaires » est
  // écrite au journal sur le compte choisi.
  async function pay(slipId: string, data: z.infer<typeof payInput>, res: Response) {
    const slip = await prisma.payslip.findUnique({ where: { id: slipId }, include: { employee: { select: { name: true } } } });
    if (!slip) throw new HttpError(404, "Bulletin introuvable");
    const paidAt = new Date();
    const { count } = await prisma.payslip.updateMany({ where: { id: slip.id, status: "VALIDATED" }, data: { status: "PAID", paidAt, paidBy: who(res) } });
    if (count === 0) throw new HttpError(409, slip.status === "PAID" ? "Ce salaire est déjà payé" : "Ce bulletin n'est pas encore validé par les ressources humaines");
    try {
      const entry = await prisma.ledgerEntry.create({
        data: {
          date: data.date ?? new Date(`${paidAt.toISOString().slice(0, 10)}T00:00:00Z`),
          direction: "OUT",
          category: "SALARIES",
          amount: slip.net,
          accountId: data.accountId,
          label: `Salaire ${slip.month} — ${slip.employee.name}`,
          reference: data.reference ?? null,
          counterparty: slip.employee.name,
          source: "PAYROLL",
          sourceId: slip.id,
          createdBy: who(res),
        },
      });
      await prisma.payslip.update({ where: { id: slip.id }, data: { ledgerEntryId: entry.id } });
      return entry;
    } catch (e) {
      // Écriture impossible : le bulletin redevient à payer.
      await prisma.payslip.update({ where: { id: slip.id }, data: { status: "VALIDATED", paidAt: null, paidBy: null } }).catch(() => {});
      throw e;
    }
  }

  router.post("/accounting/payslips/:id/pay", async (req, res) => {
    try {
      const data = parse(payInput, req.body);
      await activeAccount(data.accountId);
      const entry = await pay(String(req.params.id), data, res);
      res.json({ ok: true, entryId: entry.id });
    } catch (e) {
      fail(res, e);
    }
  });

  // Payer tous les bulletins validés d'un mois depuis un même compte.
  router.post("/accounting/payroll/pay", async (req, res) => {
    try {
      const data = parse(payInput.extend({ month: z.string() }), req.body);
      const month = parseMonth(data.month);
      if (!month) throw new HttpError(400, "Mois invalide (AAAA-MM)");
      await activeAccount(data.accountId);
      const slips = await prisma.payslip.findMany({ where: { month: month.month, status: "VALIDATED" }, select: { id: true } });
      let paid = 0;
      for (const s of slips) {
        try {
          await pay(s.id, data, res);
          paid++;
        } catch (e) {
          if (!(e instanceof HttpError)) throw e;
        }
      }
      res.json({ paid });
    } catch (e) {
      fail(res, e);
    }
  });

  // ---------------------------------------------------------------- Chiffres de la plateforme

  // Abonnements mensuels des commerces (restaurants, boutiques en ligne) : ce qui doit rentrer chaque mois.
  router.get("/accounting/subscriptions", async (_req, res) => {
    const [restaurants, stores] = await Promise.all([
      prisma.restaurant.findMany({
        where: { active: true, subscriptionFee: { not: null } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, kind: true, plan: true, subscriptionFee: true, commissionRate: true, phone: true },
      }),
      prisma.merchant.findMany({
        where: { storeStatus: "ONLINE", storeSubscriptionFee: { not: null } },
        orderBy: { shopName: "asc" },
        select: { id: true, shopName: true, phone: true, storeSubscriptionFee: true },
      }),
    ]);
    const rows = [
      ...restaurants.map((r) => ({ id: r.id, name: r.name, type: r.kind === "SHOP" ? "SHOP" : "RESTAURANT", plan: r.plan, monthlyFee: r.subscriptionFee ?? 0, phone: r.phone })),
      ...stores.map((m) => ({ id: m.id, name: m.shopName, type: "ONLINE_STORE", plan: null, monthlyFee: m.storeSubscriptionFee ?? 0, phone: m.phone })),
    ];
    res.json({ rows, monthlyTotal: rows.reduce((s, r) => s + r.monthlyFee, 0) });
  });

  // Synthèse d'une période : journal (recettes, dépenses, résultat), soldes des comptes, et chiffres relus de la
  // plateforme. « Revenu des commandes » = frais de livraison + commissions − remises payées par Zedeka − part des
  // livreurs (comme le rapport).
  router.get("/accounting/overview", async (req, res) => {
    try {
      const p = periodFrom(req);
      const inPeriod = { gte: p.start, lt: p.end };
      const [entries, accounts, orders, cancelled, cash, settlements, deposits, leasing, zed, payroll, subscriptions] = await Promise.all([
        prisma.ledgerEntry.findMany({ where: { date: inPeriod, voidedAt: null }, select: { direction: true, category: true, amount: true, accountId: true, voidedAt: true } }),
        balances(),
        prisma.order.findMany({
          where: { createdAt: inPeriod, status: "DELIVERED" },
          select: { deliveryFee: true, extraFee: true, discount: true, promoPayer: true, commission: true, driverEarning: true, total: true },
        }),
        prisma.order.aggregate({ _sum: { cancellationFee: true }, where: { createdAt: inPeriod, status: "CANCELLED" } }),
        prisma.cashCollection.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { createdAt: inPeriod } }),
        prisma.restaurantSettlement.aggregate({ _sum: { amountDue: true }, _count: { _all: true }, where: { paidAt: inPeriod } }),
        prisma.restaurantDeposit.aggregate({ _sum: { amount: true }, where: { createdAt: inPeriod } }),
        prisma.leasePayment.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { status: "CONFIRMED", reviewedAt: inPeriod } }),
        prisma.zedPayment.aggregate({ _sum: { amount: true }, _count: { _all: true }, where: { status: "CONFIRMED", reviewedAt: inPeriod } }),
        prisma.payslip.aggregate({ _sum: { net: true }, _count: { _all: true }, where: { status: "PAID", paidAt: inPeriod } }),
        prisma.restaurant.aggregate({ _sum: { subscriptionFee: true }, where: { active: true, subscriptionFee: { not: null } } }),
      ]);
      const stores = await prisma.merchant.aggregate({ _sum: { storeSubscriptionFee: true }, where: { storeStatus: "ONLINE", storeSubscriptionFee: { not: null } } });
      res.json({
        period: p,
        journal: journalTotals(entries),
        accounts,
        cashOnHand: accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0),
        platform: {
          deliveredOrders: orders.length,
          orderValue: orders.reduce((s, o) => s + o.total, 0),
          ordersRevenue: orders.reduce((s, o) => s + zedekaRevenue(o), 0),
          driverEarnings: orders.reduce((s, o) => s + o.driverEarning, 0),
          cancellationFees: cancelled._sum.cancellationFee ?? 0,
          cashRemitted: cash._sum.amount ?? 0,
          cashCollections: cash._count._all,
          restaurantPayouts: settlements._sum.amountDue ?? 0,
          settlementsPaid: settlements._count._all,
          restaurantDeposits: deposits._sum.amount ?? 0,
          leasingCollected: leasing._sum.amount ?? 0,
          leasingPayments: leasing._count._all,
          zedPlansCollected: zed._sum.amount ?? 0,
          zedPayments: zed._count._all,
          payrollPaid: payroll._sum.net ?? 0,
          payslipsPaid: payroll._count._all,
          monthlySubscriptions: (subscriptions._sum.subscriptionFee ?? 0) + (stores._sum.storeSubscriptionFee ?? 0),
        },
      });
    } catch (e) {
      fail(res, e);
    }
  });

  // Paiements des livreurs sur une période : ce que chacun a gagné par ses courses (indépendants), son salaire
  // (salariés) et les espèces remises à Zedeka.
  router.get("/accounting/drivers", async (req, res) => {
    try {
      const p = periodFrom(req);
      const inPeriod = { gte: p.start, lt: p.end };
      const [earnings, cash, drivers] = await Promise.all([
        prisma.order.groupBy({ by: ["driverId"], where: { status: "DELIVERED", createdAt: inPeriod, driverId: { not: null } }, _sum: { driverEarning: true }, _count: { _all: true } }),
        prisma.cashCollection.groupBy({ by: ["driverId"], where: { createdAt: inPeriod }, _sum: { amount: true } }),
        prisma.driver.findMany({ where: { deletedAt: null }, select: { id: true, name: true, phone: true, employment: true, monthlySalary: true, status: true } }),
      ]);
      const earned = new Map(earnings.map((g) => [g.driverId, g]));
      const remitted = new Map(cash.map((g) => [g.driverId, g._sum.amount ?? 0]));
      const rows = drivers
        .map((d) => ({
          id: d.id,
          name: d.name,
          phone: d.phone,
          employment: d.employment,
          monthlySalary: d.employment === "STAFF" ? (d.monthlySalary ?? 0) : null,
          deliveries: earned.get(d.id)?._count._all ?? 0,
          earnings: earned.get(d.id)?._sum.driverEarning ?? 0,
          cashRemitted: remitted.get(d.id) ?? 0,
        }))
        .filter((r) => r.deliveries > 0 || r.cashRemitted > 0 || (r.monthlySalary ?? 0) > 0)
        .sort((a, b) => b.earnings - a.earnings || b.deliveries - a.deliveries);
      res.json({
        period: p,
        rows,
        totals: { deliveries: rows.reduce((s, r) => s + r.deliveries, 0), earnings: rows.reduce((s, r) => s + r.earnings, 0), cashRemitted: rows.reduce((s, r) => s + r.cashRemitted, 0) },
      });
    } catch (e) {
      fail(res, e);
    }
  });

  return router;
}
