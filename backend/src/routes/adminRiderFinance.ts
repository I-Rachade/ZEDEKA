import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import { canMove, financeInclude, KINDS, NEXT, productLabel, remaining, STATUSES, statusMessage, type FinanceStatus } from "../riderFinance.js";
import { staffName } from "../team.js";
import { firstError } from "../util.js";

// Admin « Assurance et crédit » : demandes des livreurs (assurance, micro-crédit, sinistres), transmission à un
// partenaire, décision, contrat en cours, remboursements notés à la main, clôture.

const statusInput = z.object({
  status: z.enum(STATUSES),
  partner: z.string().trim().max(80).nullish(),
  partnerRef: z.string().trim().max(60).nullish(),
  approvedAmount: z.number().int().min(0).max(10_000_000).nullish(),
  totalDue: z.number().int().min(0).max(20_000_000).nullish(),
  installment: z.number().int().min(0).max(10_000_000).nullish(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
  staffNote: z.string().trim().max(1000).nullish(),
});
const paymentInput = z.object({
  amount: z.number().int().min(1).max(10_000_000),
  method: z.enum(["CASH", "FLOOZ", "TMONEY"]),
  reference: z.string().trim().toUpperCase().max(40).optional(),
});

const adminInclude = { ...financeInclude, driver: { select: { id: true, name: true, phone: true, employment: true } } } as const;
type AdminRow = Prisma.RiderFinanceGetPayload<{ include: typeof adminInclude }>;
const view = (r: AdminRow) => ({ ...r, productLabel: productLabel(r.kind, r.product), paid: r.repayments.reduce((s, p) => s + p.amount, 0), remaining: remaining(r), next: NEXT[r.status as FinanceStatus] ?? [] });

export function adminRiderFinanceRouter(prisma: PrismaClient, config: { notifier: Notifier }) {
  const router = Router();

  router.get("/rider-finance/summary", async (_req, res) => {
    const rows = await prisma.riderFinance.findMany({ where: { status: { in: ["REQUESTED", "SENT", "APPROVED", "ACTIVE"] } }, include: { repayments: { select: { amount: true } } } });
    const loans = rows.filter((r) => r.kind === "LOAN" && r.status === "ACTIVE");
    res.json({
      toReview: rows.filter((r) => r.status === "REQUESTED").length,
      atPartner: rows.filter((r) => r.status === "SENT").length,
      activePolicies: rows.filter((r) => r.kind === "INSURANCE" && r.status === "ACTIVE").length,
      activeLoans: loans.length,
      outstanding: loans.reduce((s, r) => s + (remaining(r) ?? 0), 0),
      openClaims: rows.filter((r) => r.kind === "CLAIM").length,
    });
  });

  router.get("/rider-finance/requests", async (req, res) => {
    const kind = z.enum(KINDS).optional().catch(undefined).parse(req.query.kind);
    const closed = req.query.status === "closed";
    const where: Prisma.RiderFinanceWhereInput = {
      ...(kind ? { kind } : {}),
      status: closed ? { in: ["REFUSED", "CLOSED", "CANCELLED"] } : { in: ["REQUESTED", "SENT", "APPROVED", "ACTIVE"] },
      ...(typeof req.query.driverId === "string" && req.query.driverId ? { driverId: req.query.driverId } : {}),
    };
    const rows = await prisma.riderFinance.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: adminInclude });
    res.json(rows.map(view));
  });

  router.post("/rider-finance/requests/:id/status", async (req, res) => {
    const parsed = statusInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const d = parsed.data;
    const row = await prisma.riderFinance.findUnique({ where: { id: req.params.id } });
    if (!row) {
      res.status(404).json({ error: "Demande introuvable" });
      return;
    }
    // Même statut : seules les informations (partenaire, montants, dates, note) changent.
    if (d.status !== row.status && !canMove(row.status, d.status)) {
      res.status(409).json({ error: "Cette étape n'est pas possible depuis le statut actuel" });
      return;
    }
    const now = new Date();
    const partner = d.partner === undefined ? row.partner : d.partner || null;
    if (d.status === "SENT" && !partner) {
      res.status(400).json({ error: "Indiquez le partenaire à qui la demande est transmise" });
      return;
    }
    const data: Prisma.RiderFinanceUpdateManyMutationInput = {
      status: d.status,
      partner,
      ...(d.partnerRef !== undefined ? { partnerRef: d.partnerRef || null } : {}),
      ...(d.approvedAmount !== undefined ? { approvedAmount: d.approvedAmount } : {}),
      ...(d.totalDue !== undefined ? { totalDue: d.totalDue } : {}),
      ...(d.installment !== undefined ? { installment: d.installment } : {}),
      ...(d.startsAt !== undefined ? { startsAt: d.startsAt ? new Date(d.startsAt) : null } : {}),
      ...(d.endsAt !== undefined ? { endsAt: d.endsAt ? new Date(d.endsAt) : null } : {}),
      ...(d.staffNote !== undefined ? { staffNote: d.staffNote || null } : {}),
      updatedBy: staffName(res),
      ...(d.status !== row.status && d.status === "SENT" ? { sentAt: now } : {}),
      ...(d.status !== row.status && (d.status === "APPROVED" || d.status === "REFUSED") ? { decidedAt: now } : {}),
      ...(d.status !== row.status && d.status === "ACTIVE" ? { activatedAt: now, startsAt: d.startsAt ? new Date(d.startsAt) : (row.startsAt ?? now) } : {}),
      ...(d.status !== row.status && (d.status === "CLOSED" || d.status === "CANCELLED") ? { closedAt: now } : {}),
    };
    // Écrit seulement si le statut n'a pas changé entre-temps.
    const { count } = await prisma.riderFinance.updateMany({ where: { id: row.id, status: row.status }, data });
    if (!count) {
      res.status(409).json({ error: "Cette demande vient de changer : rechargez la page" });
      return;
    }
    const msg = d.status !== row.status ? statusMessage(row.kind, d.status, partner) : null;
    if (msg)
      await config.notifier
        .push("driver", row.driverId, { title: "Assurance et crédit", body: msg, url: "/livreur/assurance", tag: `finance-${row.id}` })
        .catch(() => {});
    res.json(view(await prisma.riderFinance.findUniqueOrThrow({ where: { id: row.id }, include: adminInclude })));
  });

  // Remboursement d'un crédit (ou prime d'assurance) encaissé : le crédit se clôt quand tout est remboursé.
  router.post("/rider-finance/requests/:id/payments", async (req, res) => {
    const parsed = paymentInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const row = await prisma.riderFinance.findFirst({ where: { id: req.params.id, kind: { in: ["LOAN", "INSURANCE"] }, status: "ACTIVE" } });
    if (!row) {
      res.status(404).json({ error: "Crédit ou assurance en cours introuvable" });
      return;
    }
    if (parsed.data.method !== "CASH" && !parsed.data.reference) {
      res.status(400).json({ error: "Indiquez la référence de la transaction" });
      return;
    }
    await prisma.riderFinancePayment.create({ data: { requestId: row.id, amount: parsed.data.amount, method: parsed.data.method, reference: parsed.data.reference || null, recordedBy: staffName(res) } });
    let after = await prisma.riderFinance.findUniqueOrThrow({ where: { id: row.id }, include: adminInclude });
    if (after.kind === "LOAN" && remaining(after) === 0) {
      const { count } = await prisma.riderFinance.updateMany({ where: { id: row.id, status: "ACTIVE" }, data: { status: "CLOSED", closedAt: new Date(), updatedBy: staffName(res) } });
      if (count) {
        await config.notifier
          .push("driver", row.driverId, { title: "Assurance et crédit", body: statusMessage("LOAN", "CLOSED", row.partner) ?? "", url: "/livreur/assurance", tag: `finance-${row.id}` })
          .catch(() => {});
        after = await prisma.riderFinance.findUniqueOrThrow({ where: { id: row.id }, include: adminInclude });
      }
    }
    res.status(201).json(view(after));
  });

  return router;
}
