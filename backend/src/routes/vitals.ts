import { Router, text } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

// Mesures de vitesse envoyées par les téléphones (navigator.sendBeacon, en texte) : temps d'affichage, réactivité,
// stabilité. Ni compte, ni numéro, ni adresse IP : seulement la page, la mesure, la valeur et le type de réseau.
export const VITAL_NAMES = ["LCP", "FCP", "TTFB", "INP", "CLS"] as const;

const batch = z
  .array(
    z.object({
      page: z.string().trim().min(1).max(80).regex(/^\/[A-Za-z0-9/_[\]-]*$/),
      name: z.enum(VITAL_NAMES),
      value: z.number().finite().min(0).max(120_000),
      connection: z.string().trim().max(10).regex(/^[a-z0-9-]+$/).optional(),
    }),
  )
  .min(1)
  .max(10);

export function vitalsRouter(prisma: PrismaClient) {
  const router = Router();
  // sendBeacon envoie du texte : le corps JSON est lu à la main.
  router.post("/vitals", text({ type: "*/*", limit: "8kb" }), async (req, res) => {
    let raw: unknown = req.body;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    const parsed = batch.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ error: "Mesures invalides" });
      return;
    }
    await prisma.webVital.createMany({ data: parsed.data.map((v) => ({ ...v, value: Math.round(v.value * 1000) / 1000 })) });
    res.status(204).end();
  });
  return router;
}

// 75e centile (la valeur que 3 visites sur 4 ne dépassent pas), la référence des Core Web Vitals.
export function p75(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.75) - 1)];
}

// Résumé des 7 derniers jours par page : 75e centile de chaque mesure et nombre de visites mesurées.
export async function vitalsSummary(prisma: PrismaClient, now = new Date()) {
  const rows = await prisma.webVital.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 7 * 24 * 3600_000) } },
    select: { page: true, name: true, value: true },
    orderBy: { createdAt: "desc" },
    take: 20_000,
  });
  const byPage = new Map<string, Map<string, number[]>>();
  for (const r of rows) {
    const page = byPage.get(r.page) ?? new Map<string, number[]>();
    byPage.set(r.page, page);
    const list = page.get(r.name) ?? [];
    page.set(r.name, list);
    list.push(r.value);
  }
  return [...byPage.entries()]
    .map(([page, m]) => ({
      page,
      visits: Math.max(m.get("TTFB")?.length ?? 0, m.get("FCP")?.length ?? 0, m.get("LCP")?.length ?? 0),
      ...Object.fromEntries(VITAL_NAMES.map((n) => [n, p75(m.get(n) ?? [])])),
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 15);
}
