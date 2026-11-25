import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "./notify.js";
import { HttpError } from "./routes/adminWrite.js";

// Pièce d'identité des livreurs et conducteurs : dates de délivrance et d'expiration, et rappels avant l'expiration
// (30 jours, 7 jours, le jour même). L'équipe est prévenue quand une pièce est expirée.

const DAY = 86_400_000;
export const SOON_DAYS = 30;

export const idDatesInput = z.object({
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date de délivrance"),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indiquez la date d'expiration"),
});

// Dates d'une pièce saisies dans l'appli (AAAA-MM-JJ) : délivrée au plus tard aujourd'hui, valable aujourd'hui.
export function checkIdDates(raw: z.infer<typeof idDatesInput>, now = new Date()): { issuedAt: Date; expiresAt: Date } {
  const issuedAt = new Date(`${raw.issuedAt}T00:00:00Z`);
  const expiresAt = new Date(`${raw.expiresAt}T00:00:00Z`);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) throw new HttpError(400, "Date invalide");
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (issuedAt > today) throw new HttpError(400, "La date de délivrance ne peut pas être dans le futur");
  if (expiresAt <= issuedAt) throw new HttpError(400, "La date d'expiration doit être après la date de délivrance");
  if (expiresAt < today) throw new HttpError(400, "Cette pièce est expirée : envoyez une pièce en cours de validité");
  return { issuedAt, expiresAt };
}

export type IdStatus = "VALID" | "SOON" | "EXPIRED" | "NO_DATES";

// Expirée le lendemain de sa date d'expiration (la pièce est valable tout ce jour-là).
export function idStatus(expiresAt: Date | null | undefined, now = new Date()): IdStatus {
  if (!expiresAt) return "NO_DATES";
  const end = expiresAt.getTime() + DAY;
  if (end <= now.getTime()) return "EXPIRED";
  return end - now.getTime() <= SOON_DAYS * DAY ? "SOON" : "VALID";
}

// Rappel à envoyer pour cette échéance (le dernier envoyé est noté sur la pièce), ou null.
export function noticeDue(expiresAt: Date, sent: string | null, now = new Date()): "30" | "7" | "EXPIRED" | null {
  const left = expiresAt.getTime() + DAY - now.getTime();
  const due = left <= 0 ? "EXPIRED" : left <= 7 * DAY ? "7" : left <= SOON_DAYS * DAY ? "30" : null;
  if (!due) return null;
  const order = ["30", "7", "EXPIRED"];
  return sent && order.indexOf(sent) >= order.indexOf(due) ? null : due;
}

const fmt = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// Tâche planifiée (une fois par heure) : rappels au livreur, et à l'équipe quand la pièce est expirée.
export async function notifyExpiringIds(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const docs = await prisma.zedDocument.findMany({
    where: { kind: "ID_CARD", expiresAt: { lte: new Date(now.getTime() + SOON_DAYS * DAY) }, OR: [{ expiryNotice: null }, { expiryNotice: { not: "EXPIRED" } }], driver: { deletedAt: null } },
    select: { id: true, driverId: true, expiresAt: true, expiryNotice: true, driver: { select: { name: true } } },
  });
  let sent = 0;
  for (const d of docs) {
    if (!d.expiresAt) continue;
    const due = noticeDue(d.expiresAt, d.expiryNotice, now);
    if (!due) continue;
    // Noté avant l'envoi : une erreur d'envoi ne fait pas répéter le rappel chaque heure.
    const claimed = await prisma.zedDocument.updateMany({ where: { id: d.id, expiryNotice: d.expiryNotice }, data: { expiryNotice: due } });
    if (claimed.count === 0) continue;
    sent++;
    // Seule l'équipe dépose la pièce : le livreur l'apporte, l'équipe (admin, adjoint) l'enregistre dans l'admin.
    const body =
      due === "EXPIRED"
        ? `Votre pièce d'identité a expiré le ${fmt(d.expiresAt)}. Apportez la nouvelle à l'équipe Zedeka.`
        : `Votre pièce d'identité expire le ${fmt(d.expiresAt)}. Pensez à apporter la nouvelle à l'équipe Zedeka.`;
    await notifier
      .push("driver", d.driverId, { title: due === "EXPIRED" ? "Pièce d'identité expirée" : "Pièce d'identité bientôt expirée", body, url: "/livreur/profil", tag: `id-expiry-${d.driverId}` })
      .catch(() => {});
    await notifier
      .staff("DRIVERS", {
        title: due === "EXPIRED" ? "Pièce d'identité expirée" : "Pièce d'identité bientôt expirée",
        body: `${d.driver.name} : pièce d'identité ${due === "EXPIRED" ? "expirée" : "qui expire"} le ${fmt(d.expiresAt)}.`,
        url: "/admin/livreurs",
        tag: `id-expiry-${d.driverId}`,
      })
      .catch(() => {});
  }
  return sent;
}
