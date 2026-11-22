import type { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { driverLease, MAX_PAY_DAYS } from "../lease.js";
import type { Notifier } from "../notify.js";
import { formatFcfa } from "../pricing.js";
import { firstError } from "../util.js";

// Appli livreur : « Ma moto » (leasing). Le compte du contrat, l'historique des paiements, et l'envoi d'un paiement
// mobile money (référence confirmée ensuite par l'équipe, comme le plan Zed).
export function driverLeaseRoutes(router: Router, prisma: PrismaClient, config: { notifier: Notifier }) {
  router.get("/lease", async (_req, res) => {
    res.json(await driverLease(prisma, res.locals.driverId));
  });

  router.post("/lease/payments", async (req, res) => {
    const parsed = z
      .object({
        days: z.number().int().min(1).max(MAX_PAY_DAYS),
        method: z.enum(["FLOOZ", "TMONEY"]),
        reference: z.string().trim().toUpperCase().min(4, "Indiquez la référence de la transaction").max(40),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const driverId: string = res.locals.driverId;
    const contract = await prisma.leaseContract.findFirst({ where: { driverId, status: "ACTIVE" }, select: { id: true, dailyRate: true, plate: true, driver: { select: { name: true } } } });
    if (!contract) {
      res.status(404).json({ error: "Vous n'avez pas de moto en leasing" });
      return;
    }
    const { reference, days, method } = parsed.data;
    // Une référence ne sert qu'une fois (leasing comme plan Zed).
    const [lease, zed] = await Promise.all([prisma.leasePayment.findUnique({ where: { reference } }), prisma.zedPayment.findUnique({ where: { reference } })]);
    if (lease || zed) {
      res.status(409).json({ error: "Cette référence a déjà été envoyée" });
      return;
    }
    const amount = contract.dailyRate * days;
    await prisma.leasePayment.create({ data: { contractId: contract.id, driverId, amount, days, method, reference } });
    await config.notifier
      .staff("FINANCE", {
        title: "Paiement de leasing à confirmer",
        body: `${contract.driver.name} (${contract.plate}) : ${formatFcfa(amount)}, ${days} jour(s) (${method === "FLOOZ" ? "Flooz" : "T-Money"}, réf. ${reference})`,
        url: "/admin/leasing?onglet=paiements",
        tag: `lease-pay-${contract.id}`,
      })
      .catch(() => {});
    res.status(201).json(await driverLease(prisma, driverId));
  });
}
