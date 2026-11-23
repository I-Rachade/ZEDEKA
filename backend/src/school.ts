import type { PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";
import type { Notifier } from "./notify.js";
import { formatFcfa } from "./pricing.js";
import { getSettings } from "./util.js";

// Transport scolaire : abonnement mensuel aux trajets maison-école, assurés par un conducteur Course Zed attitré.
//
// - Écolier (SCHOOL) : le parent inscrit son enfant depuis son compte client. Seuls des conducteurs Zed actifs et
//   vérifiés pour le transport d'enfants (Driver.schoolCleared, contrôle fait par l'équipe) peuvent être attitrés.
//   L'enfant n'est remis qu'avec un code : celui de l'école à l'arrivée à l'école, celui de la maison au retour.
// - Étudiant (STUDENT) : l'étudiant s'abonne lui-même, horaires libres jour par jour, pas de code de remise.
//
// Les trajets d'un jour (SchoolTrip) sont créés au fil de l'eau (tâche planifiée, ou à l'ouverture des écrans) pour
// chaque abonnement actif avec un conducteur : pas de trajet un jour férié, un jour d'absence, ni quand le mois
// n'est pas payé (passé les jours de grâce du réglage). Lomé vit à l'heure UTC : dates et heures sont en UTC.
// Le paiement est encaissé par l'équipe (espèces au bureau, virement) et enregistré dans l'admin.

export const PASS_KINDS = ["SCHOOL", "STUDENT"] as const;
export type PassKind = (typeof PASS_KINDS)[number];
export const PASS_STATUSES = ["PENDING", "ACTIVE", "PAUSED", "ENDED", "REJECTED"] as const;
export type PassStatus = (typeof PASS_STATUSES)[number];
export const LEGS = ["GO", "BACK"] as const;
export type Leg = (typeof LEGS)[number];
export const KIND_LABEL: Record<PassKind, string> = { SCHOOL: "Abonnement écolier", STUDENT: "Abonnement étudiant" };

// Un parent ou un étudiant : au plus 6 abonnements en cours (fratrie).
export const MAX_PASSES_PER_CUSTOMER = 6;
// Équipe prévenue quand un trajet n'a pas commencé ce nombre de minutes après l'heure prévue.
export const LATE_ALERT_MINUTES = 15;
// Position du conducteur montrée au parent si elle a moins de 5 minutes.
export const LIVE_POSITION_MS = 5 * 60_000;
// Deux trajets d'un même conducteur à moins de 30 minutes d'écart : conflit signalé à l'attribution.
export const CONFLICT_MINUTES = 30;

export type DaySlot = { go?: string; back?: string };
export type Schedule = Partial<Record<"1" | "2" | "3" | "4" | "5" | "6" | "7", DaySlot>>;

const DAY = 86_400_000;
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);
export const monthKey = (d: Date) => d.toISOString().slice(0, 7);
// Jour de la semaine ISO (1 = lundi … 7 = dimanche) d'une date AAAA-MM-JJ.
export const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const addDays = (date: string, n: number) => dayKey(new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY));

// « HH:MM » vérifié caractère par caractère (pas d'expression régulière sur une saisie).
export function isTime(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== 5 || v[2] !== ":") return false;
  const digits = [v[0], v[1], v[3], v[4]];
  if (!digits.every((c) => c >= "0" && c <= "9")) return false;
  return Number(v.slice(0, 2)) < 24 && Number(v.slice(3)) < 60;
}

export function isDate(v: unknown): v is string {
  if (typeof v !== "string" || v.length !== 10) return false;
  const shaped = [...v].every((ch, i) => (i === 4 || i === 7 ? ch === "-" : ch >= "0" && ch <= "9"));
  return shaped && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && dayKey(new Date(`${v}T00:00:00Z`)) === v;
}

const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

// Horaires reçus de l'appli : renvoie l'emploi du temps nettoyé, ou un message d'erreur.
export function parseSchedule(raw: unknown): Schedule | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "Choisissez au moins un jour";
  const out: Schedule = {};
  for (const [day, slot] of Object.entries(raw as Record<string, unknown>)) {
    if (!["1", "2", "3", "4", "5", "6", "7"].includes(day)) return "Jour de la semaine invalide";
    if (!slot || typeof slot !== "object") continue;
    const { go, back } = slot as Record<string, unknown>;
    const clean: DaySlot = {};
    if (go !== undefined && go !== null && go !== "") {
      if (!isTime(go)) return "Heure de départ invalide (HH:MM)";
      if (minutes(go) < 5 * 60 || minutes(go) > 21 * 60) return "Les trajets se font entre 5 h et 21 h";
      clean.go = go;
    }
    if (back !== undefined && back !== null && back !== "") {
      if (!isTime(back)) return "Heure de retour invalide (HH:MM)";
      if (minutes(back) < 5 * 60 || minutes(back) > 21 * 60) return "Les trajets se font entre 5 h et 21 h";
      clean.back = back;
    }
    if (clean.go && clean.back && minutes(clean.back) <= minutes(clean.go)) return "L'heure de retour doit suivre l'heure d'aller";
    if (clean.go || clean.back) out[day as keyof Schedule] = clean;
  }
  if (Object.keys(out).length === 0) return "Choisissez au moins un jour et une heure";
  return out;
}

export function readSchedule(json: string): Schedule {
  try {
    const parsed = parseSchedule(JSON.parse(json));
    return typeof parsed === "string" ? {} : parsed;
  } catch {
    return {};
  }
}

// Aller et retour certains jours : tarif aller-retour. Sinon (aller seul, ou retour seul) : tarif simple.
export function isRoundTrip(schedule: Schedule): boolean {
  const slots = Object.values(schedule);
  return slots.some((s) => s?.go) && slots.some((s) => s?.back);
}

type FeeSettings = { schoolMonthlyFee: number; schoolOneWayFee: number; studentMonthlyFee: number; studentOneWayFee: number };
export function monthlyFeeFor(kind: PassKind, schedule: Schedule, s: FeeSettings): number {
  const round = isRoundTrip(schedule);
  if (kind === "SCHOOL") return round ? s.schoolMonthlyFee : s.schoolOneWayFee;
  return round ? s.studentMonthlyFee : s.studentOneWayFee;
}

// Code de remise à 4 chiffres (tiré au hasard, jamais 0000).
export const newCode = () => String(randomInt(1, 10_000)).padStart(4, "0");

// Le mois de cette date est-il couvert ? Payé, ou encore dans les jours de grâce du début du mois.
export function monthCovered(date: string, paidMonths: string[], graceDays: number): boolean {
  if (paidMonths.includes(date.slice(0, 7))) return true;
  return Number(date.slice(8, 10)) <= graceDays;
}

type PassForPlan = {
  id: string;
  kind: string;
  status: string;
  driverId: string | null;
  startsOn: string | null;
  schedule: string;
  payments: { month: string }[];
  absences: { date: string; leg: string }[];
};
type Holiday = { date: string; kind: string };

// Trajets prévus ce jour pour un abonnement (sans tenir compte de ceux déjà créés) : jambe et heure, ou la raison.
export function plannedLegs(pass: PassForPlan, date: string, holidays: Holiday[], graceDays: number): { leg: Leg; time: string }[] {
  if (pass.status !== "ACTIVE" || !pass.driverId) return [];
  if (pass.startsOn && date < pass.startsOn) return [];
  if (holidays.some((h) => h.date === date && (h.kind === "ALL" || h.kind === pass.kind))) return [];
  if (!monthCovered(date, pass.payments.map((p) => p.month), graceDays)) return [];
  const slot = readSchedule(pass.schedule)[String(isoWeekday(date)) as keyof Schedule];
  if (!slot) return [];
  const absent = (leg: Leg) => pass.absences.some((a) => a.date === date && (a.leg === "BOTH" || a.leg === leg));
  const legs: { leg: Leg; time: string }[] = [];
  if (slot.go && !absent("GO")) legs.push({ leg: "GO", time: slot.go });
  if (slot.back && !absent("BACK")) legs.push({ leg: "BACK", time: slot.back });
  return legs;
}

export const scheduledAt = (date: string, time: string) => new Date(`${date}T${time}:00Z`);

const planInclude = (date: string) => ({
  payments: { select: { month: true } },
  absences: { where: { date }, select: { date: true, leg: true } },
});

// Crée les trajets manquants du jour (idempotent : un trajet par abonnement, jour et jambe). Renvoie le nombre créé.
export async function ensureTrips(prisma: PrismaClient, date: string, where: { driverId?: string; passId?: string; customerId?: string } = {}): Promise<number> {
  const [passes, holidays, s] = await Promise.all([
    prisma.schoolPass.findMany({ where: { status: "ACTIVE", driverId: where.driverId ?? { not: null }, ...(where.passId ? { id: where.passId } : {}), ...(where.customerId ? { customerId: where.customerId } : {}) }, include: planInclude(date) }),
    prisma.schoolHoliday.findMany({ where: { date }, select: { date: true, kind: true } }),
    getSettings(prisma),
  ]);
  if (passes.length === 0) return 0;
  const existing = await prisma.schoolTrip.findMany({ where: { date, passId: { in: passes.map((p) => p.id) } }, select: { passId: true, leg: true } });
  const have = new Set(existing.map((t) => `${t.passId}:${t.leg}`));
  let created = 0;
  for (const pass of passes) {
    for (const { leg, time } of plannedLegs(pass, date, holidays, s.schoolGraceDays)) {
      if (have.has(`${pass.id}:${leg}`)) continue;
      // Créé en même temps par un autre appel : la clé unique (abonnement, jour, jambe) refuse le doublon.
      const ok = await prisma.schoolTrip
        .create({ data: { passId: pass.id, driverId: pass.driverId, date, leg, scheduledAt: scheduledAt(date, time) } })
        .then(() => true)
        .catch(() => false);
      if (ok) created++;
    }
  }
  return created;
}

// Absence ou jour férié ajouté après la création des trajets : ceux pas encore commencés sont annulés.
export async function cancelPlannedTrips(prisma: PrismaClient, where: { passId?: string; date: string; legs?: Leg[]; kind?: string }, note: string) {
  const passFilter = where.kind && where.kind !== "ALL" ? { pass: { kind: where.kind } } : {};
  return prisma.schoolTrip.updateMany({
    where: { date: where.date, status: "PLANNED", ...(where.passId ? { passId: where.passId } : {}), ...(where.legs ? { leg: { in: where.legs } } : {}), ...passFilter },
    data: { status: "CANCELLED", note },
  });
}

// Un conducteur peut-il être attitré à cet abonnement ? Message d'erreur, ou null.
export async function driverEligibilityError(prisma: PrismaClient, driverId: string, kind: PassKind, excludePassId?: string): Promise<string | null> {
  const [driver, load, s] = await Promise.all([
    prisma.driver.findUnique({ where: { id: driverId }, select: { status: true, active: true, deletedAt: true, zedStatus: true, schoolCleared: true } }),
    prisma.schoolPass.count({ where: { driverId, status: { in: ["ACTIVE", "PAUSED"] }, ...(excludePassId ? { id: { not: excludePassId } } : {}) } }),
    getSettings(prisma),
  ]);
  if (!driver || driver.deletedAt) return "Conducteur introuvable";
  if (driver.status !== "APPROVED" || !driver.active) return "Ce conducteur n'est pas validé ou son compte est suspendu";
  if (driver.zedStatus !== "ACTIVE") return "Seuls les conducteurs Course Zed actifs assurent le transport scolaire";
  if (kind === "SCHOOL" && !driver.schoolCleared) return "Ce conducteur n'est pas encore vérifié pour le transport d'enfants";
  if (s.schoolMaxPerDriver > 0 && load >= s.schoolMaxPerDriver) return `Ce conducteur a déjà ${load} abonnement(s) (maximum ${s.schoolMaxPerDriver} dans les réglages)`;
  return null;
}

// Créneaux du conducteur qui tombent à moins de 30 minutes de ceux de cet emploi du temps, le même jour de la semaine.
export function scheduleConflicts(schedule: Schedule, others: { riderName: string; schedule: string }[]): string[] {
  const out: string[] = [];
  const names = ["", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  for (const [day, slot] of Object.entries(schedule)) {
    const mine = [slot?.go, slot?.back].filter(Boolean) as string[];
    for (const other of others) {
      const theirs = readSchedule(other.schedule)[day as keyof Schedule];
      const times = [theirs?.go, theirs?.back].filter(Boolean) as string[];
      const clash = mine.find((a) => times.some((b) => Math.abs(minutes(a) - minutes(b)) < CONFLICT_MINUTES));
      if (clash) out.push(`${names[Number(day)]} ${clash} : ${other.riderName}`);
    }
  }
  return out;
}

// Compte du mois pour le parent et l'admin : mois en cours payé ou non, et le montant.
export function monthState(pass: { monthlyFee: number; status: string; payments: { month: string; amount: number }[] }, graceDays: number, now = new Date()) {
  const month = monthKey(now);
  const paid = pass.payments.some((p) => p.month === month);
  const today = dayKey(now);
  const inGrace = !paid && Number(today.slice(8, 10)) <= graceDays;
  const lastPaid = pass.payments.map((p) => p.month).sort().at(-1) ?? null;
  return { month, paid, inGrace, suspended: pass.status === "ACTIVE" && !paid && !inGrace, amount: pass.monthlyFee, lastPaidMonth: lastPaid, graceDays };
}

const legLabel = (leg: string) => (leg === "GO" ? "aller" : "retour");
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

// Notifications au parent (ou à l'étudiant) à chaque étape du trajet.
export async function notifyTripStep(
  prisma: PrismaClient,
  notifier: Notifier,
  tripId: string,
  step: "ON_THE_WAY" | "PICKED_UP" | "DROPPED" | "MISSED" | "NO_CODE",
  now = new Date(),
) {
  const trip = await prisma.schoolTrip.findUnique({
    where: { id: tripId },
    select: { leg: true, note: true, pass: { select: { id: true, customerId: true, riderName: true, kind: true, schoolName: true } }, driver: { select: { name: true, plate: true } } },
  });
  if (!trip) return;
  const who = trip.pass.riderName;
  const driver = trip.driver ? `${trip.driver.name}${trip.driver.plate ? ` (${trip.driver.plate})` : ""}` : "Le conducteur";
  const at = hhmm(now);
  const texts: Record<typeof step, { title: string; body: string }> = {
    ON_THE_WAY: {
      title: trip.leg === "GO" ? "Le conducteur arrive" : "Le conducteur part chercher " + who,
      body: trip.leg === "GO" ? `${driver} est en route pour prendre ${who} à la maison.` : `${driver} est en route vers ${trip.pass.schoolName}.`,
    },
    PICKED_UP: {
      title: `${who} est pris(e) en charge`,
      body: trip.leg === "GO" ? `${driver} a pris ${who} à la maison à ${at}. Suivez le trajet en direct.` : `${driver} a récupéré ${who} à ${trip.pass.schoolName} à ${at}.`,
    },
    DROPPED: {
      title: trip.leg === "GO" ? `${who} est arrivé(e) à l'école` : `${who} est arrivé(e) à la maison`,
      body: trip.leg === "GO" ? `Remis(e) à ${trip.pass.schoolName} à ${at}.` : `Déposé(e) à la maison à ${at}.`,
    },
    MISSED: {
      title: `Trajet ${legLabel(trip.leg)} non fait`,
      body: `${driver} n'a pas pu prendre ${who}${trip.note ? ` : ${trip.note}` : "."} Appelez le conducteur ou Zedeka.`,
    },
    NO_CODE: {
      title: `${who} remis(e) sans code`,
      body: `${driver} a remis ${who} sans le code de remise (${trip.note ?? "raison non précisée"}). Zedeka est prévenu ; appelez-nous en cas de doute.`,
    },
  };
  await notifier.push("customer", trip.pass.customerId, { ...texts[step], url: `/app/ecole/${trip.pass.id}`, tag: `school-${tripId}` }).catch(() => {});
}

// Tâche planifiée (toutes les 5 minutes) : trajets du jour créés, et l'équipe prévenue d'un trajet pas commencé
// 15 minutes après l'heure prévue (une fois par trajet). Le conducteur reçoit aussi un rappel.
export async function runSchoolTrips(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const today = dayKey(now);
  await ensureTrips(prisma, today);
  const late = await prisma.schoolTrip.findMany({
    where: { date: today, status: "PLANNED", lateAlertedAt: null, scheduledAt: { lte: new Date(now.getTime() - LATE_ALERT_MINUTES * 60_000) } },
    select: { id: true, leg: true, scheduledAt: true, driverId: true, pass: { select: { id: true, riderName: true, kind: true } }, driver: { select: { name: true, phone: true } } },
    take: 50,
  });
  for (const t of late) {
    const claimed = await prisma.schoolTrip.updateMany({ where: { id: t.id, lateAlertedAt: null }, data: { lateAlertedAt: now } });
    if (claimed.count === 0) continue;
    await notifier
      .staff("ORDERS", {
        title: "Transport scolaire : trajet pas commencé",
        body: `${t.pass.riderName} (${legLabel(t.leg)} de ${hhmm(t.scheduledAt)}) : ${t.driver ? `${t.driver.name}, ${t.driver.phone}` : "aucun conducteur"} n'a pas démarré.`,
        url: `/admin/ecole/${t.pass.id}`,
        tag: `school-late-${t.id}`,
      })
      .catch(() => {});
    if (t.driverId)
      await notifier
        .push("driver", t.driverId, { title: "Trajet scolaire en retard", body: `${t.pass.riderName} attend depuis ${hhmm(t.scheduledAt)}.`, url: "/livreur/ecole", tag: `school-${t.id}`, alarm: true })
        .catch(() => {});
  }
  return late.length;
}

// Rappel au parent quand un mois n'est pas payé : affiché dans l'appli ; montant pour le message de l'admin.
export const unpaidText = (fee: number) => `Mois non payé : ${formatFcfa(fee)} à régler au bureau Zedeka pour continuer les trajets.`;
