import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { KPI_DAYS, kpiReport } from "../kpi.js";
import { PERF_HOURS, perfReport } from "../perfReport.js";
import { vitalsSummary } from "./vitals.js";

// « Indicateurs » (KPI du métier) et « Performance » (API, disponibilité, vitesse vue par les téléphones) :
// directeur et administrateur adjoint (lecture), comme le rapport et la santé (src/team.ts).
export function adminKpiRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/kpi", async (req, res) => {
    const asked = Number(req.query.days);
    const days = (KPI_DAYS as readonly number[]).includes(asked) ? asked : 7;
    res.json(await kpiReport(prisma, days));
  });

  router.get("/perf", async (req, res) => {
    const asked = Number(req.query.hours);
    const hours = (PERF_HOURS as readonly number[]).includes(asked) ? asked : 24;
    const [report, vitals] = await Promise.all([perfReport(prisma, hours), vitalsSummary(prisma).catch(() => [])]);
    res.json({ ...report, vitals });
  });

  return router;
}
