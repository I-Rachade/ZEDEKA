import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Notifier } from "./notify.js";
import { publicCode } from "./pricing.js";
import type { ModuleView } from "./services.js";

// Demandes de service : un seul moteur pour les cinq services du bouton « Services » (courses, gaz et eau,
// lessive, ménage, dépannage). Le client remplit un formulaire propre au service, reçoit une estimation, et la
// demande part aux livreurs ou prestataires qui ont ce service dans leur profil. Le premier qui accepte la prend ;
// l'équipe peut aussi l'attribuer depuis l'admin. Le client paie le prestataire à la fin (espèces ou mobile money).

export const REQUEST_STATUSES = ["PENDING", "ACCEPTED", "ON_THE_WAY", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_OPEN = ["PENDING", "ACCEPTED", "ON_THE_WAY", "IN_PROGRESS"] as const;
export const REQUEST_WITH_PROVIDER = ["ACCEPTED", "ON_THE_WAY", "IN_PROGRESS"] as const;

export const requestCode = () => publicCode("SV");

// Garde-fous : demandes ouvertes par client, demandes par minute et par jour, missions en cours par prestataire.
export const MAX_OPEN_PER_CUSTOMER = 3;
export const MAX_PER_MINUTE = 2;
export const MAX_PER_DAY = 10;
export const MAX_MISSIONS_PER_PROVIDER = 3;
// Créneau : au moins 30 minutes après la demande, au plus 14 jours, entre 7 h et 19 h (Lomé vit à l'heure UTC).
export const SLOT_MIN_MS = 30 * 60_000;
export const SLOT_MAX_MS = 14 * 86_400_000;
export const SLOT_HOURS = [7, 19] as const;

const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);

// Ce que le client remplit pour chaque service.
export const DETAILS = {
  ERRAND: z.object({
    items: text(3, 800, "Écrivez votre liste de courses"),
    budget: z.number({ invalid_type_error: "Indiquez votre budget" }).int().min(500, "Budget de 500 FCFA au moins").max(200_000, "Budget de 200 000 FCFA au plus"),
    shop: z.string().trim().max(120).optional(),
  }),
  GAS: z.object({
    product: z.enum(["GAS_6", "GAS_12", "WATER"], { errorMap: () => ({ message: "Choisissez gaz ou eau" }) }),
    quantity: z.number().int().min(1, "Une unité au moins").max(10, "10 au plus par demande"),
    brand: z.string().trim().max(40).optional(),
  }),
  LAUNDRY: z.object({
    bags: z.number().int().min(1, "Un sac au moins").max(10, "10 sacs au plus"),
    ironing: z.boolean().default(false),
  }),
  CLEANING: z.object({
    hours: z.number().int().min(2, "2 heures au moins").max(8, "8 heures au plus"),
    place: z.enum(["HOME", "OFFICE"]).default("HOME"),
    rooms: z.number().int().min(1).max(20).default(2),
  }),
  REPAIR: z.object({
    trade: z.enum(["PLUMBING", "ELECTRICITY", "OTHER"], { errorMap: () => ({ message: "Choisissez le type de panne" }) }),
    problem: text(10, 500, "Décrivez la panne en quelques mots (10 caractères au moins)"),
  }),
} as const;
export type RequestModule = keyof typeof DETAILS;
export const isRequestModule = (code: string): code is RequestModule => code in DETAILS;

// Services à domicile : un créneau est obligatoire. Courses et gaz : dès que possible, ou un créneau.
export const NEEDS_SLOT: readonly RequestModule[] = ["LAUNDRY", "CLEANING", "REPAIR"];

type Details = { [K in RequestModule]: z.infer<(typeof DETAILS)[K]> };

// Quantité qui multiplie le prix unitaire.
export function quantityOf<K extends RequestModule>(code: K, details: Details[K]): number {
  if (code === "GAS") return (details as Details["GAS"]).quantity;
  if (code === "LAUNDRY") return (details as Details["LAUNDRY"]).bags;
  if (code === "CLEANING") return (details as Details["CLEANING"]).hours;
  return 0;
}

export function estimateFor<K extends RequestModule>(module: Pick<ModuleView, "price">, code: K, details: Details[K]): number {
  const price = module.price ?? { base: 0, unit: 0 };
  return price.base + price.unit * quantityOf(code, details);
}

const fcfa = (n: number) => `${n.toLocaleString("fr-FR").replace(/ | /g, " ")} FCFA`;
const GAS_LABEL = { GAS_6: "bouteille de gaz 6 kg", GAS_12: "bouteille de gaz 12 kg", WATER: "bidon d'eau" } as const;
const TRADE_LABEL = { PLUMBING: "Plomberie", ELECTRICITY: "Électricité", OTHER: "Réparation" } as const;

// Résumé lisible pour le prestataire, l'admin et la liste des commandes du client.
export function summaryOf<K extends RequestModule>(code: K, details: Details[K]): string {
  switch (code) {
    case "ERRAND": {
      const d = details as Details["ERRAND"];
      return `Courses${d.shop ? ` chez ${d.shop}` : ""}, budget ${fcfa(d.budget)}`;
    }
    case "GAS": {
      const d = details as Details["GAS"];
      const label = GAS_LABEL[d.product];
      const plural = d.quantity > 1 ? label.replace(/^(\S+)/, "$1s") : label;
      return `${d.quantity} ${plural}${d.brand ? ` (${d.brand})` : ""}`;
    }
    case "LAUNDRY": {
      const d = details as Details["LAUNDRY"];
      return `Lessive : ${d.bags} sac${d.bags > 1 ? "s" : ""}${d.ironing ? ", avec repassage" : ""}`;
    }
    case "CLEANING": {
      const d = details as Details["CLEANING"];
      return `Ménage ${d.hours} h (${d.place === "OFFICE" ? "bureau" : "maison"}, ${d.rooms} pièce${d.rooms > 1 ? "s" : ""})`;
    }
    default: {
      const d = details as Details["REPAIR"];
      return `${TRADE_LABEL[d.trade]} : ${d.problem.slice(0, 80)}`;
    }
  }
}

// Créneau valable ? Renvoie un message d'erreur, ou null.
export function slotError(code: RequestModule, slot: Date | null, now: Date): string | null {
  if (!slot) return NEEDS_SLOT.includes(code) ? "Choisissez le jour et l'heure" : null;
  const delta = slot.getTime() - now.getTime();
  if (delta < SLOT_MIN_MS) return "Choisissez un créneau dans 30 minutes au moins";
  if (delta > SLOT_MAX_MS) return "Choisissez un créneau dans les 14 prochains jours";
  const hour = slot.getUTCHours() + slot.getUTCMinutes() / 60;
  if (hour < SLOT_HOURS[0] || hour > SLOT_HOURS[1]) return "Créneaux de 7 h à 19 h";
  return null;
}

export const codesOf = (serviceCodes: string | null | undefined): string[] => (serviceCodes ?? "").split(",").map((c) => c.trim()).filter(Boolean);

export function parseDetails(details: string): Record<string, unknown> {
  try {
    const value = JSON.parse(details) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Livreurs et prestataires qui font ce service : validés, actifs, pas supprimés.
export async function providersFor(prisma: PrismaClient, code: string) {
  const drivers = await prisma.driver.findMany({
    where: { status: "APPROVED", active: true, deletedAt: null, serviceCodes: { contains: code } },
    select: { id: true, serviceCodes: true },
    take: 200,
  });
  return drivers.filter((d) => codesOf(d.serviceCodes).includes(code));
}

// Nouvelle demande : alerte aux prestataires du service (50 au plus) et à l'équipe.
export async function announceRequest(prisma: PrismaClient, notifier: Notifier, request: { id: string; code: string; module: string; summary: string; address: string }) {
  const providers = await providersFor(prisma, request.module);
  await Promise.all(
    providers.slice(0, 50).map((p) =>
      notifier.push("driver", p.id, { title: "Nouvelle mission", body: `${request.summary} · ${request.address}`, url: "/livreur/missions", tag: `sv-${request.id}`, alarm: true }).catch(() => 0),
    ),
  );
  await notifier
    .staff("ORDERS", {
      title: providers.length ? "Nouvelle demande de service" : "Demande de service sans prestataire",
      body: `${request.code} · ${request.summary}${providers.length ? "" : " : aucun prestataire n'a ce service, attribuez-la."}`,
      url: "/admin/services/demandes",
      tag: `sv-${request.id}`,
    })
    .catch(() => 0);
  return providers.length;
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: "Recherche d'un prestataire",
  ACCEPTED: "Prestataire trouvé",
  ON_THE_WAY: "En route",
  IN_PROGRESS: "En cours",
  DONE: "Terminée",
  CANCELLED: "Annulée",
};
