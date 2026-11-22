import type { PrismaClient } from "@prisma/client";
import type { Notifier } from "./notify.js";
import { formatFcfa } from "./pricing.js";
import { HttpError } from "./routes/adminWrite.js";
import { getSettings } from "./util.js";

// Leasing de motos de Zedeka aux livreurs et conducteurs indépendants. Deux types de moto : HOME (rechargeable à la
// maison) et ZEDEKA (moto Zedeka), chacun avec son prix par jour (réglages). Le prix est figé sur le contrat.
//
// Compte du livreur : chaque jour commencé depuis le début du contrat est dû (Lomé vit à l'heure UTC : la journée
// commence à minuit UTC), jusqu'au jour où la moto est rendue. Les paiements confirmés couvrent des jours entiers
// à la suite, du premier jour du contrat. Le jour en cours est « à payer aujourd'hui » ; il n'est en retard que le
// lendemain. Le livreur paie en plus ses frais d'application habituels (plan Zed, part des courses).

export const LEASE_KINDS = ["HOME", "ZEDEKA"] as const;
export type LeaseKind = (typeof LEASE_KINDS)[number];
export const LEASE_KIND_LABEL: Record<LeaseKind, string> = { HOME: "Moto rechargeable à la maison", ZEDEKA: "Moto Zedeka" };

// L'équipe est prévenue à partir de ce nombre de jours de retard.
export const STAFF_ALERT_DAYS = 3;
// Paiement envoyé depuis l'appli : de 1 à 31 jours d'un coup.
export const MAX_PAY_DAYS = 31;

const DAY = 86_400_000;
const dayIndex = (d: Date) => Math.floor(d.getTime() / DAY);
export const dayKey = (index: number) => new Date(index * DAY).toISOString().slice(0, 10);
export const todayKey = (now = new Date()) => dayKey(dayIndex(now));

export type LeaseState = "PAID" | "DUE_TODAY" | "LATE" | "ENDED";
export type LeaseBalance = {
  state: LeaseState;
  daysDue: number; // jours commencés depuis le début (jour en cours compris)
  paidDays: number; // jours entiers couverts par les paiements confirmés
  paidUntil: string | null; // dernier jour couvert (AAAA-MM-JJ), null si rien n'est payé
  lateDays: number; // jours passés non payés (sans le jour en cours)
  owed: number; // à payer pour être à jour, jour en cours compris (FCFA)
  credit: number; // payé d'avance au-delà d'aujourd'hui (FCFA)
  paid: number; // total confirmé (FCFA)
};

type ContractLike = { dailyRate: number; startsAt: Date; status: string; endedAt: Date | null };
type PaymentLike = { amount: number; status: string };

export function leaseBalance(contract: ContractLike, payments: PaymentLike[], now = new Date()): LeaseBalance {
  const start = dayIndex(contract.startsAt);
  const ended = contract.status === "ENDED" && contract.endedAt;
  const last = ended ? Math.min(dayIndex(contract.endedAt!), dayIndex(now)) : dayIndex(now);
  const daysDue = Math.max(0, last - start + 1);
  const paid = payments.filter((p) => p.status === "CONFIRMED").reduce((sum, p) => sum + p.amount, 0);
  const rate = Math.max(1, contract.dailyRate);
  const paidDays = Math.floor(paid / rate);
  // Contrat en cours : le jour en cours n'est pas encore en retard. Moto rendue : tout jour dû non payé l'est.
  const pastDays = ended ? daysDue : Math.max(0, daysDue - 1);
  const lateDays = Math.max(0, pastDays - paidDays);
  const owed = Math.max(0, daysDue * contract.dailyRate - paid);
  const credit = Math.max(0, paid - daysDue * contract.dailyRate);
  const state: LeaseState = ended ? (owed > 0 ? "LATE" : "ENDED") : lateDays > 0 ? "LATE" : owed > 0 ? "DUE_TODAY" : "PAID";
  return { state, daysDue, paidDays, paidUntil: paidDays > 0 ? dayKey(start + paidDays - 1) : null, lateDays, owed, credit, paid };
}

// Revenu du leasing ramené à la journée : prix par jour des contrats en cours.
export const leasingPerDay = (contracts: { dailyRate: number }[]) => contracts.reduce((sum, c) => sum + c.dailyRate, 0);

// Date de début saisie dans l'admin (AAAA-MM-JJ) : au plus 31 jours dans le passé ou dans le futur.
export function parseStartDate(raw: string | undefined, now = new Date()): Date {
  if (!raw) return new Date(dayIndex(now) * DAY);
  const d = new Date(`${raw}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(d.getTime())) throw new HttpError(400, "Date de début invalide");
  if (Math.abs(dayIndex(d) - dayIndex(now)) > 31) throw new HttpError(400, "La date de début doit être à moins d'un mois d'aujourd'hui");
  return d;
}

export const contractWithPayments = { payments: { select: { amount: true, status: true } } } as const;

// Peut-on louer une moto à ce livreur ? Livreur ou conducteur validé, indépendant, sans autre contrat en cours,
// et plaque libre. Renvoie un message d'erreur, ou null.
export async function leaseEligibilityError(prisma: PrismaClient, driverId: string, plate: string): Promise<string | null> {
  const [driver, open, plateTaken] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId }, select: { status: true, deletedAt: true, employment: true } }),
    prisma.leaseContract.count({ where: { driverId, status: "ACTIVE" } }),
    prisma.leaseContract.count({ where: { plate, status: "ACTIVE" } }),
  ]);
  if (!driver || driver.deletedAt) return "Livreur introuvable";
  if (driver.status !== "APPROVED") return "Le leasing est réservé aux livreurs et conducteurs Zedeka validés";
  if (driver.employment !== "FREELANCE") return "Les livreurs salariés prennent une moto du parc, pas en leasing";
  if (open > 0) return "Ce livreur a déjà une moto en leasing : terminez d'abord son contrat";
  if (plateTaken > 0) return "Cette plaque est déjà louée à un autre livreur";
  return null;
}

// Retard qui bloque la mise en ligne (réglage « jours de retard avant blocage », 0 : jamais). Message, ou null.
export async function leaseBlockError(prisma: PrismaClient, driverId: string, now = new Date()): Promise<string | null> {
  const s = await getSettings(prisma);
  if (!s.leaseBlockDays || s.leaseBlockDays <= 0) return null;
  const contracts = await prisma.leaseContract.findMany({ where: { driverId, status: "ACTIVE" }, include: contractWithPayments });
  for (const c of contracts) {
    const b = leaseBalance(c, c.payments, now);
    if (b.lateDays >= s.leaseBlockDays) return `Leasing en retard de ${b.lateDays} jour(s) : payez ${formatFcfa(b.owed)} pour vous remettre en ligne`;
  }
  return null;
}

// Ce que l'appli livreur montre du leasing : le contrat en cours (ou le dernier), son compte et les paiements.
export async function driverLease(prisma: PrismaClient, driverId: string, now = new Date()) {
  const [contract, s] = await Promise.all([
    prisma.leaseContract.findFirst({
      where: { driverId },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }], // ACTIVE avant ENDED
      include: { payments: { orderBy: { createdAt: "desc" }, select: { id: true, amount: true, days: true, method: true, reference: true, status: true, note: true, createdAt: true } } },
    }),
    getSettings(prisma),
  ]);
  if (!contract) return { contract: null, balance: null, payments: [], paymentNumber: s.zedPaymentNumber, blockDays: s.leaseBlockDays };
  const { payments, remindedOn: _r, staffAlertedAt: _a, createdBy: _c, ...rest } = contract;
  return {
    contract: { ...rest, kindLabel: LEASE_KIND_LABEL[contract.kind as LeaseKind] ?? contract.kind },
    balance: leaseBalance(contract, payments, now),
    payments: payments.slice(0, 30),
    paymentNumber: s.zedPaymentNumber,
    blockDays: s.leaseBlockDays,
  };
}

// Résumé pour l'accueil de l'appli livreur (/current) : null sans contrat en cours.
export async function leaseSummary(prisma: PrismaClient, driverId: string, now = new Date()) {
  const c = await prisma.leaseContract.findFirst({ where: { driverId, status: "ACTIVE" }, include: contractWithPayments });
  if (!c) return null;
  const b = leaseBalance(c, c.payments, now);
  return { plate: c.plate, kind: c.kind, state: b.state, owed: b.owed, lateDays: b.lateDays, paidUntil: b.paidUntil };
}

const longDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });

// Tâche planifiée (une fois par heure, rappels envoyés à partir de 7 h) : au plus un rappel par jour au livreur
// (retard, ou dernier jour payé), et l'équipe prévenue une fois à partir de 3 jours de retard.
export async function remindLeases(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const contracts = await prisma.leaseContract.findMany({
    where: { status: "ACTIVE" },
    include: { ...contractWithPayments, driver: { select: { name: true } } },
  });
  const today = todayKey(now);
  let sent = 0;
  for (const c of contracts) {
    const b = leaseBalance(c, c.payments, now);
    // Équipe : prévenue une fois par retard ; remis à zéro dès que le livreur est à jour.
    if (b.lateDays >= STAFF_ALERT_DAYS && !c.staffAlertedAt) {
      await prisma.leaseContract.update({ where: { id: c.id }, data: { staffAlertedAt: now } });
      await notifier
        .staff("FINANCE", {
          title: "Leasing en retard",
          body: `${c.driver.name} (${c.plate}) : ${b.lateDays} jours de retard, ${formatFcfa(b.owed)} à payer.`,
          url: `/admin/leasing/${c.id}`,
          tag: `lease-late-${c.id}`,
        })
        .catch(() => {});
    } else if (b.lateDays < STAFF_ALERT_DAYS && c.staffAlertedAt) {
      await prisma.leaseContract.update({ where: { id: c.id }, data: { staffAlertedAt: null } });
    }
    if (now.getUTCHours() < 7 || c.remindedOn === today) continue;
    const lastPaidDay = b.paidUntil === today && b.owed === 0;
    if (b.state !== "LATE" && !lastPaidDay) continue;
    const claimed = await prisma.leaseContract.updateMany({ where: { id: c.id, remindedOn: c.remindedOn }, data: { remindedOn: today } });
    if (claimed.count === 0) continue;
    sent++;
    await notifier
      .push("driver", c.driverId, {
        title: b.state === "LATE" ? "Leasing en retard" : "Leasing payé jusqu'à ce soir",
        body:
          b.state === "LATE"
            ? `${b.lateDays} jour(s) de retard : ${formatFcfa(b.owed)} à payer pour votre moto ${c.plate}.`
            : `Votre leasing est payé jusqu'au ${longDate(today)}. Payez demain d'avance pour rester à jour.`,
        url: "/livreur/moto",
        tag: `lease-${c.id}`,
      })
      .catch(() => {});
  }
  return sent;
}

// Paiement confirmé : le livreur est prévenu de son nouveau compte.
export async function notifyLeasePaid(prisma: PrismaClient, notifier: Notifier, contractId: string, now = new Date()) {
  const c = await prisma.leaseContract.findUnique({ where: { id: contractId }, include: contractWithPayments });
  if (!c) return;
  const b = leaseBalance(c, c.payments, now);
  await notifier
    .push("driver", c.driverId, {
      title: "Paiement de leasing confirmé",
      body: b.paidUntil ? `Votre moto ${c.plate} est payée jusqu'au ${longDate(b.paidUntil)}.` : `Paiement enregistré pour votre moto ${c.plate}.`,
      url: "/livreur/moto",
      tag: `lease-${c.id}`,
    })
    .catch(() => {});
}
