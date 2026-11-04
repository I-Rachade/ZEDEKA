import type { Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { orderCode } from "./pricing.js";

export const phone = z.string().trim().regex(/^\+?[0-9 ]{8,15}$/, "Numéro de téléphone invalide");

export const emailInput = z.string().trim().toLowerCase().max(120).email("Adresse e-mail invalide");
// E-mail facultatif d'un formulaire : champ vide = pas d'e-mail.
export const optionalEmail = z.union([z.literal("").transform(() => null), emailInput, z.null()]);

// Lien d'image fourni par un partenaire : https uniquement (http seulement en local), jamais javascript:, data: ou autre.
export const webUrl = z
  .string()
  .trim()
  .max(500)
  .url("lien invalide")
  .refine((v) => /^https:\/\//i.test(v) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(v), "Le lien doit commencer par https://");

export function firstError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Données invalides";
  if (issue.code === "invalid_type" && issue.received === "undefined") return `Champ manquant : ${issue.path.join(".")}`;
  return issue.path.length ? `${issue.path.join(".")} : ${issue.message}` : issue.message;
}

// Prisma P2002 = contrainte d'unicité, P2025 = enregistrement introuvable.
export function sendPrismaError(e: unknown, res: Response): boolean {
  const code = (e as { code?: string }).code;
  if (code === "P2002") res.status(409).json({ error: "Cette valeur existe déjà" });
  else if (code === "P2025") res.status(404).json({ error: "Introuvable" });
  else return false;
  return true;
}

// Une seule lecture dans le cas courant : un upsert coûte 3 requêtes D1 à chaque appel (lecture, contrôle, relecture),
// et presque toutes les pages en font un. La ligne n'est créée que sur une base neuve.
export async function getSettings(prisma: PrismaClient) {
  return (await prisma.settings.findUnique({ where: { id: 1 } })) ?? prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Le code peut (très rarement) entrer en collision : on réessaie.
export async function createOrderWithCode(
  prisma: PrismaClient,
  data: Omit<Prisma.OrderUncheckedCreateInput, "code">,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.order.create({ data: { ...data, code: orderCode() } });
    } catch (e) {
      if (attempt < 4 && (e as { code?: string }).code === "P2002") continue;
      throw e;
    }
  }
}
