import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "../notify.js";
import { formatFcfa } from "../pricing.js";
import { CLAIM_PRODUCTS, driverFinance, INSURANCE_PRODUCTS, LOAN_MAX, LOAN_MAX_MONTHS, LOAN_MIN, LOAN_PRODUCTS, OPEN, productLabel } from "../riderFinance.js";
import { firstError } from "../util.js";

// Appli livreur : « Assurance et crédit ». Demandes d'assurance et de micro-crédit, sinistres sur une assurance en
// cours, et suivi (étapes, partenaire, remboursements). L'équipe est prévenue de chaque nouvelle demande.

const keys = (o: Record<string, string>) => Object.keys(o) as [string, ...string[]];
const requestInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("INSURANCE"), product: z.enum(keys(INSURANCE_PRODUCTS)), note: z.string().trim().max(500).optional() }),
  z.object({
    kind: z.literal("LOAN"),
    product: z.enum(keys(LOAN_PRODUCTS)),
    amount: z.number().int().min(LOAN_MIN, `Au moins ${formatFcfa(LOAN_MIN)}`).max(LOAN_MAX, `Au plus ${formatFcfa(LOAN_MAX)}`),
    months: z.number().int().min(1).max(LOAN_MAX_MONTHS),
    note: z.string().trim().min(5, "Dites en quelques mots à quoi servira le crédit").max(500),
  }),
]);
const claimInput = z.object({
  product: z.enum(keys(CLAIM_PRODUCTS)),
  incidentAt: z.string().datetime({ message: "Date invalide" }),
  amount: z.number().int().min(0).max(10_000_000).optional(),
  note: z.string().trim().min(5, "Décrivez ce qui s'est passé").max(1000),
});

export function driverFinanceRoutes(router: Router, prisma: PrismaClient, config: { notifier: Notifier }) {
  router.get("/finance", async (_req, res) => {
    res.json(await driverFinance(prisma, res.locals.driverId));
  });

  router.post("/finance/requests", async (req, res) => {
    const parsed = requestInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const data = parsed.data;
    const open = await prisma.riderFinance.count({ where: { driverId, kind: data.kind, product: data.product, status: { in: OPEN } } });
    if (open) {
      res.status(409).json({ error: "Vous avez déjà une demande en cours pour ce produit" });
      return;
    }
    // Un seul crédit à la fois.
    if (data.kind === "LOAN" && (await prisma.riderFinance.count({ where: { driverId, kind: "LOAN", status: { in: OPEN } } }))) {
      res.status(409).json({ error: "Remboursez votre crédit en cours avant d'en demander un autre" });
      return;
    }
    const created = await prisma.riderFinance.create({
      data: {
        driverId,
        kind: data.kind,
        product: data.product,
        amount: data.kind === "LOAN" ? data.amount : null,
        months: data.kind === "LOAN" ? data.months : null,
        note: data.note || null,
      },
      include: { driver: { select: { name: true, phone: true } } },
    });
    await config.notifier
      .staff("DRIVERS", {
        title: data.kind === "LOAN" ? "Demande de micro-crédit" : "Demande d'assurance",
        body: `${created.driver.name} : ${productLabel(data.kind, data.product)}${data.kind === "LOAN" ? ` · ${formatFcfa(data.amount)} sur ${data.months} mois` : ""}`,
        url: "/admin/assurance",
        tag: `finance-${created.id}`,
      })
      .catch(() => {});
    res.status(201).json(await driverFinance(prisma, driverId));
  });

  // Sinistre sur une assurance active du livreur.
  router.post("/finance/requests/:id/claims", async (req, res) => {
    const parsed = claimInput.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const policy = await prisma.riderFinance.findFirst({ where: { id: req.params.id, driverId, kind: "INSURANCE", status: "ACTIVE" }, include: { driver: { select: { name: true } } } });
    if (!policy) {
      res.status(404).json({ error: "Assurance introuvable ou pas encore active" });
      return;
    }
    const incidentAt = new Date(parsed.data.incidentAt);
    if (incidentAt.getTime() > Date.now() + 86_400_000) {
      res.status(400).json({ error: "La date du sinistre est dans le futur" });
      return;
    }
    const claim = await prisma.riderFinance.create({
      data: { driverId, kind: "CLAIM", product: parsed.data.product, parentId: policy.id, partner: policy.partner, incidentAt, amount: parsed.data.amount ?? null, note: parsed.data.note },
    });
    await config.notifier
      .staff("DRIVERS", {
        title: "Sinistre déclaré",
        body: `${policy.driver.name} : ${productLabel("CLAIM", claim.product)} (${productLabel("INSURANCE", policy.product)}${policy.partner ? `, ${policy.partner}` : ""})`,
        url: "/admin/assurance",
        tag: `finance-${claim.id}`,
      })
      .catch(() => {});
    res.status(201).json(await driverFinance(prisma, driverId));
  });

  // Le livreur retire sa demande tant que l'équipe ne l'a pas transmise.
  router.post("/finance/requests/:id/cancel", async (req, res) => {
    const driverId: string = res.locals.driverId;
    const { count } = await prisma.riderFinance.updateMany({ where: { id: req.params.id, driverId, status: "REQUESTED" }, data: { status: "CANCELLED", closedAt: new Date(), updatedBy: "Livreur" } });
    if (!count) {
      res.status(409).json({ error: "Cette demande ne peut plus être annulée" });
      return;
    }
    res.json(await driverFinance(prisma, driverId));
  });
}
