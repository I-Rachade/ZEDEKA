// Mode Zed (moto-taxi) : le client appelle, le conducteur Zed le plus proche (dans le rayon des réglages, 1 km par
// défaut) reçoit une alerte qui sonne et a 15 s pour accepter ; sinon l'alerte passe au suivant le plus proche.
// Destination facultative, en texte libre, et pas de prix dans l'application : le prix se fait sur place.
//
// Le passage au suivant n'attend pas la tâche planifiée (une fois par minute) : chaque interrogation de l'écran
// d'attente du client (toutes les 3 s), chaque refus et chaque ouverture de l'application conducteur font avancer
// la file (advanceRide). La tâche de chaque minute sert de filet (advanceAllRides).
import type { PrismaClient } from "@prisma/client";
import { distanceKm, type Point } from "./delivery.js";
import type { Notifier } from "./notify.js";
import { OPEN } from "./orderFlow.js";
import { publicCode } from "./pricing.js";
import { getSettings } from "./util.js";

export const RIDE_OPEN = ["SEARCHING", "ACCEPTED", "ONBOARD"] as const;
// Course réservée à l'avance, en attente de son heure (avec ou sans conducteur déjà retenu).
export const RIDE_SCHEDULED = "SCHEDULED";
// Réservation : au plus tôt 30 minutes après la demande, au plus tard 7 jours après.
export const SCHEDULE_MIN_MS = 30 * 60_000;
export const SCHEDULE_MAX_MS = 7 * 86_400_000;
// L'heure approche : 15 minutes avant, la course passe au conducteur retenu ou part en recherche.
export const SCHEDULE_LEAD_MS = 15 * 60_000;
// Courses réservées en attente par client.
export const MAX_SCHEDULED = 5;
// Un conducteur ne retient pas deux courses à moins d'une heure d'écart.
export const RESERVE_GAP_MS = 60 * 60_000;
export const RIDE_WITH_DRIVER = ["ACCEPTED", "ONBOARD"] as const;
// Position du conducteur plus ancienne : on ne s'y fie plus pour un rayon de 1 km.
export const ZED_FRESH_POSITION_MS = 2 * 60_000;
// Demande toujours en recherche après ce délai (client parti, file bloquée) : close par la tâche planifiée.
export const SEARCH_GIVE_UP_MS = 5 * 60_000;
// Propositions laissées sans réponse d'affilée avant de couper « Disponible pour les Zed ».
export const MAX_MISSED = 3;
export const DOCUMENT_KINDS = ["SELFIE", "ID_CARD", "LICENCE", "MOTO"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const REQUIRED_DOCUMENTS: DocumentKind[] = ["SELFIE", "ID_CARD", "LICENCE"];

type ZedSettings = { zedRadiusM: number; zedOfferSeconds: number; zedMaxOffers: number };

export const rideCode = () => publicCode("ZR");

// --- Plan Zed ---

export type PlanPeriod = { startsAt: Date | null; endsAt: Date | null; status: string };

// Période en cours (la plus lointaine des périodes confirmées qui couvre maintenant), ou null.
export function activePlan(payments: PlanPeriod[], now = new Date()): { endsAt: Date } | null {
  const ends = payments
    .filter((p) => p.status === "CONFIRMED" && p.startsAt && p.endsAt && p.startsAt.getTime() <= now.getTime() && p.endsAt.getTime() > now.getTime())
    .map((p) => p.endsAt!.getTime());
  return ends.length ? { endsAt: new Date(Math.max(...ends)) } : null;
}

// Nouvelle période : à la suite de la dernière confirmée si elle n'est pas finie, sinon dès maintenant.
export function nextPeriod(payments: PlanPeriod[], days: number, now = new Date()): { startsAt: Date; endsAt: Date } {
  const last = Math.max(now.getTime(), ...payments.filter((p) => p.status === "CONFIRMED" && p.endsAt).map((p) => p.endsAt!.getTime()));
  return { startsAt: new Date(last), endsAt: new Date(last + days * 86_400_000) };
}

// Où-clause Prisma : plan Zed en cours à cette heure.
export const withActivePlan = (now: Date) => ({ zedPayments: { some: { status: "CONFIRMED", startsAt: { lte: now }, endsAt: { gt: now } } } });

// --- Choix des conducteurs ---

export type ZedCandidate = { id: string; lastLatitude: number | null; lastLongitude: number | null; lastLocationAt: Date | null };

// Conducteurs dans le rayon, avec une position récente, du plus proche au plus loin (distance en mètres).
export function rankZedDrivers(drivers: ZedCandidate[], at: Point, radiusM: number, now = new Date()): { id: string; distanceM: number }[] {
  return drivers
    .filter((d) => d.lastLatitude !== null && d.lastLongitude !== null && d.lastLocationAt && now.getTime() - d.lastLocationAt.getTime() <= ZED_FRESH_POSITION_MS)
    .map((d) => ({ id: d.id, distanceM: Math.round(distanceKm(at, { latitude: d.lastLatitude!, longitude: d.lastLongitude! }) * 1000) }))
    .filter((d) => d.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

// Conducteurs Zed libres maintenant : dossier validé, plan en cours, disponibles, sans course ni alerte en cours.
export function freeZedDrivers(prisma: PrismaClient, now: Date) {
  return prisma.driver.findMany({
    where: {
      zedStatus: "ACTIVE",
      zedAvailable: true,
      active: true,
      status: "APPROVED",
      deletedAt: null,
      employment: "FREELANCE",
      lastLocationAt: { gte: new Date(now.getTime() - ZED_FRESH_POSITION_MS) },
      ...withActivePlan(now),
      orders: { none: { status: { in: OPEN }, handedOverAt: null } },
      assignments: { none: { status: "SENT" } },
      zedOffers: { none: { status: "SENT" } },
      zedRides: { none: { status: { in: [...RIDE_WITH_DRIVER] } } },
    },
    select: { id: true, lastLatitude: true, lastLongitude: true, lastLocationAt: true },
  });
}

export const offerExpiresAt = (sentAt: Date, seconds: number) => new Date(sentAt.getTime() + seconds * 1000);

// Une alerte restée sans réponse : comptée au conducteur ; à la 3e d'affilée, il n'est plus disponible.
async function missed(prisma: PrismaClient, notifier: Notifier, driverId: string) {
  const d = await prisma.driver.update({ where: { id: driverId }, data: { zedMissed: { increment: 1 } }, select: { zedMissed: true } });
  if (d.zedMissed >= MAX_MISSED) {
    await prisma.driver.update({ where: { id: driverId }, data: { zedAvailable: false, zedMissed: 0 } });
    await notifier.push("driver", driverId, {
      title: "Vous n'êtes plus disponible pour les Zed",
      body: "3 appels sans réponse. Rallumez « Disponible pour les Zed » quand vous êtes prêt.",
      url: "/livreur",
      tag: "zed-off",
    });
  }
}

// --- Courses réservées à l'avance ---

// Heure demandée valable ? Message d'erreur à montrer au client, ou null.
export function scheduleError(at: Date, now = new Date()): string | null {
  if (Number.isNaN(at.getTime())) return "Heure invalide";
  if (at.getTime() < now.getTime() + SCHEDULE_MIN_MS) return "Réservez au moins 30 minutes à l'avance, ou appelez un Zed maintenant";
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_MS) return "Réservez au plus 7 jours à l'avance";
  return null;
}

// Début de la recherche d'un conducteur : la demande pour un appel immédiat, 15 min avant l'heure pour une réservation.
export const searchStartedAt = (r: { createdAt: Date; scheduledFor?: Date | null }) =>
  r.scheduledFor ? new Date(Math.max(r.createdAt.getTime(), r.scheduledFor.getTime() - SCHEDULE_LEAD_MS)) : r.createdAt;

const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

// L'heure approche : la course retenue par un conducteur lui revient (ACCEPTED), les autres partent en recherche.
export async function activateScheduledRides(prisma: PrismaClient, notifier: Notifier, now = new Date(), settings?: ZedSettings) {
  const due = await prisma.zedRide.findMany({
    where: { status: RIDE_SCHEDULED, scheduledFor: { lte: new Date(now.getTime() + SCHEDULE_LEAD_MS) } },
    select: { id: true, customerId: true, driverId: true, scheduledFor: true, landmark: true, destination: true, driver: { select: { name: true, plate: true } } },
    take: 100,
  });
  for (const r of due) {
    const at = r.scheduledFor ? hhmm(r.scheduledFor) : "";
    if (r.driverId) {
      const { count } = await prisma.zedRide.updateMany({ where: { id: r.id, status: RIDE_SCHEDULED, driverId: r.driverId }, data: { status: "ACCEPTED", acceptedAt: now } });
      if (!count) continue;
      void notifier
        .push("driver", r.driverId, { title: `Course réservée à ${at}`, body: `C'est l'heure de partir chercher votre client${r.landmark ? ` (${r.landmark})` : ""}.`, url: "/livreur", tag: `zed-${r.id}`, alarm: true })
        .catch(() => {});
      void notifier
        .push("customer", r.customerId, { title: "Votre Zed arrive", body: `${r.driver?.name ?? "Votre conducteur"} (${r.driver?.plate ?? "moto"}) part vous chercher pour ${at}.`, url: "/app/zed", tag: `zed-${r.id}` })
        .catch(() => {});
      continue;
    }
    const { count } = await prisma.zedRide.updateMany({ where: { id: r.id, status: RIDE_SCHEDULED, driverId: null }, data: { status: "SEARCHING" } });
    if (count) await advanceRide(prisma, notifier, r.id, now, settings);
  }
  return due.length;
}

// Fait avancer une course en recherche : alerte expirée close, puis alerte au conducteur suivant, ou « aucun Zed ».
// Sans effet sur une course qui n'est plus en recherche ou dont l'alerte court encore.
export async function advanceRide(prisma: PrismaClient, notifier: Notifier, rideId: string, now = new Date(), settings?: ZedSettings): Promise<void> {
  const s = settings ?? (await getSettings(prisma));
  const ride = await prisma.zedRide.findUnique({
    where: { id: rideId },
    select: { id: true, code: true, status: true, latitude: true, longitude: true, customerId: true, offers: { select: { id: true, driverId: true, status: true, sentAt: true } } },
  });
  if (!ride || ride.status !== "SEARCHING") return;
  const pending = ride.offers.find((o) => o.status === "SENT");
  if (pending) {
    if (offerExpiresAt(pending.sentAt, s.zedOfferSeconds).getTime() > now.getTime()) return;
    const { count } = await prisma.zedOffer.updateMany({ where: { id: pending.id, status: "SENT" }, data: { status: "EXPIRED", respondedAt: now } });
    if (!count) return; // une autre requête vient de la traiter
    await missed(prisma, notifier, pending.driverId);
  }
  const already = new Set(ride.offers.map((o) => o.driverId));
  const next =
    ride.offers.length >= s.zedMaxOffers
      ? undefined
      : rankZedDrivers(
          (await freeZedDrivers(prisma, now)).filter((d) => !already.has(d.id)),
          ride,
          s.zedRadiusM,
          now,
        )[0];
  if (!next) {
    const { count } = await prisma.zedRide.updateMany({ where: { id: ride.id, status: "SEARCHING" }, data: { status: "NO_DRIVER" } });
    if (count) {
      void notifier
        .push("customer", ride.customerId, { title: "Aucun Zed disponible", body: "Aucun conducteur près de vous n'a accepté. Réessayez dans un instant.", url: "/app/zed", tag: `zed-${ride.id}` })
        .catch(() => {});
    }
    return;
  }
  // Une seule alerte à la fois par course : si une autre requête en a créé une entre-temps, on s'arrête là.
  const fresh = await prisma.zedOffer.count({ where: { rideId: ride.id, status: "SENT" } });
  if (fresh) return;
  await prisma.zedOffer.create({ data: { rideId: ride.id, driverId: next.id, rank: ride.offers.length + 1, distanceM: next.distanceM, sentAt: now } });
  await notifier.push("driver", next.id, {
    title: "Appel Zed à " + (next.distanceM < 1000 ? `${next.distanceM} m` : `${(next.distanceM / 1000).toFixed(1)} km`),
    body: `Un client vous attend. ${s.zedOfferSeconds} secondes pour accepter.`,
    url: "/livreur",
    tag: `zed-${ride.id}`,
    alarm: true,
  });
}

// Filet de la tâche planifiée : courses en recherche avancées, et abandonnées au-delà de 5 minutes.
export async function advanceAllRides(prisma: PrismaClient, notifier: Notifier, now = new Date()) {
  const s = await getSettings(prisma);
  await activateScheduledRides(prisma, notifier, now, s);
  const rides = await prisma.zedRide.findMany({ where: { status: "SEARCHING" }, select: { id: true, createdAt: true, scheduledFor: true }, take: 100 });
  for (const r of rides) {
    if (now.getTime() - searchStartedAt(r).getTime() > SEARCH_GIVE_UP_MS) {
      await prisma.zedRide.updateMany({ where: { id: r.id, status: "SEARCHING" }, data: { status: "NO_DRIVER" } });
      await prisma.zedOffer.updateMany({ where: { rideId: r.id, status: "SENT" }, data: { status: "CANCELLED", respondedAt: now } });
      continue;
    }
    await advanceRide(prisma, notifier, r.id, now, s);
  }
  return rides.length;
}

// Alertes en attente d'un conducteur (au plus une) : celles déjà expirées font d'abord avancer leur course.
export async function pendingOfferFor(prisma: PrismaClient, notifier: Notifier, driverId: string, now = new Date()) {
  const s = await getSettings(prisma);
  const offers = await prisma.zedOffer.findMany({
    where: { driverId, status: "SENT" },
    select: { id: true, rideId: true, sentAt: true, distanceM: true, ride: { select: { code: true, landmark: true, destination: true, latitude: true, longitude: true } } },
  });
  let current = null;
  for (const o of offers) {
    const expiresAt = offerExpiresAt(o.sentAt, s.zedOfferSeconds);
    if (expiresAt.getTime() <= now.getTime()) await advanceRide(prisma, notifier, o.rideId, now, s);
    else current = { id: o.id, expiresAt: expiresAt.toISOString(), distanceM: o.distanceM, ride: { code: o.ride.code, landmark: o.ride.landmark, destination: o.ride.destination } };
  }
  return current;
}
