// Suivi CRM de l'admin : score sur 100, groupes et alertes, pour les livreurs, les clients, les commerces
// (restaurants et boutiques) et les marchands. Tout est calculé à partir de ce que la base garde déjà (notes des
// clients, courses proposées, annulations, demandes de l'équipe) sur les 90 derniers jours, plus les notes et
// avertissements posés par l'équipe (CrmNote). Les fonctions de score sont pures : faciles à tester et à régler.

export const CRM_TYPES = ["DRIVER", "CUSTOMER", "RESTAURANT", "MERCHANT"] as const;
export type CrmType = (typeof CRM_TYPES)[number];
export const NOTE_KINDS = ["NOTE", "CALL", "WARNING", "PRAISE"] as const;

export const WINDOW_DAYS = 90;
// En dessous de ce nombre de courses ou de commandes, pas encore de score : la personne est « nouvelle ».
export const MIN_ACTIVITY = 5;
export const WATCH_BELOW = 60;
export const GOOD_FROM = 80;

export type ScorePart = { key: string; label: string; points: number; max: number; detail: string };
export type Score = { value: number | null; parts: ScorePart[] };

const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
const pct = (n: number) => `${Math.round(n * 100)} %`;
const round = (n: number) => Math.round(n);

function total(parts: ScorePart[], activity: number): Score {
  const value = activity < MIN_ACTIVITY ? null : round(parts.reduce((s, p) => s + p.points, 0));
  return { value, parts: parts.map((p) => ({ ...p, points: round(p.points) })) };
}

// Note des clients sur 5 : 5 → tout, 1 → rien. Sans avis, on compte 3/4 des points (ni bonus ni sanction).
function ratingPart(max: number, avg: number | null, count: number, label = "Note des clients"): ScorePart {
  if (!count || avg === null) return { key: "rating", label, points: max * 0.75, max, detail: "pas encore d'avis" };
  return { key: "rating", label, points: max * clamp((avg - 1) / 4), max, detail: `★ ${avg.toFixed(1).replace(".", ",")} sur ${count} avis` };
}

// Plaintes et avertissements : 5 points de moins chacun.
function complaintsPart(max: number, complaints: number, warnings: number): ScorePart {
  const n = complaints + warnings;
  const detail = n ? [complaints && `${complaints} plainte${complaints > 1 ? "s" : ""}`, warnings && `${warnings} avertissement${warnings > 1 ? "s" : ""}`].filter(Boolean).join(", ") : "aucune";
  return { key: "complaints", label: "Plaintes et avertissements", points: Math.max(0, max - 5 * n), max, detail };
}

export type DriverMetrics = {
  ratingAvg: number | null;
  ratingCount: number;
  delivered: number;
  cancelled: number; // commandes annulées alors qu'il les avait
  offered: number; // courses proposées avec une réponse (acceptée, refusée ou laissée sans réponse)
  accepted: number;
  complaints: number;
  warnings: number;
};

export function driverScore(m: DriverMetrics): Score {
  const taken = m.delivered + m.cancelled;
  return total(
    [
      ratingPart(40, m.ratingAvg, m.ratingCount),
      m.offered
        ? { key: "accept", label: "Courses acceptées", points: 20 * (m.accepted / m.offered), max: 20, detail: `${m.accepted} sur ${m.offered} (${pct(m.accepted / m.offered)})` }
        : { key: "accept", label: "Courses acceptées", points: 15, max: 20, detail: "aucune course proposée" },
      taken
        ? { key: "done", label: "Courses menées au bout", points: 20 * (m.delivered / taken), max: 20, detail: `${m.delivered} livrées, ${m.cancelled} annulées` }
        : { key: "done", label: "Courses menées au bout", points: 15, max: 20, detail: "aucune course" },
      complaintsPart(20, m.complaints, m.warnings),
    ],
    m.delivered + m.offered,
  );
}

export type CustomerMetrics = {
  orders: number;
  delivered: number;
  cancelled: number;
  refusedAtDoor: number; // annulées après le retrait par le livreur (client absent ou qui refuse)
  disputes: number; // « je n'ai pas reçu »
  complaints: number; // plaintes d'un livreur ou d'un commerce sur ses commandes
  warnings: number;
};

export function customerScore(m: CustomerMetrics): Score {
  const closed = m.delivered + m.cancelled;
  return total(
    [
      closed
        ? { key: "done", label: "Commandes livrées", points: 40 * (m.delivered / closed), max: 40, detail: `${m.delivered} sur ${closed}` }
        : { key: "done", label: "Commandes livrées", points: 30, max: 40, detail: "aucune commande terminée" },
      {
        key: "door",
        label: "Refus à la porte et litiges",
        points: Math.max(0, 30 - 10 * (m.refusedAtDoor + m.disputes)),
        max: 30,
        detail: m.refusedAtDoor + m.disputes ? `${m.refusedAtDoor} refus, ${m.disputes} litige${m.disputes > 1 ? "s" : ""}` : "aucun",
      },
      complaintsPart(30, m.complaints, m.warnings),
    ],
    m.orders,
  );
}

export type RestaurantMetrics = {
  ratingAvg: number | null;
  ratingCount: number;
  received: number;
  refused: number; // annulées sans avoir été acceptées
  delivered: number;
  timed: number; // commandes dont on connaît la préparation
  onTime: number; // prêtes au plus tard 10 min après le temps annoncé
  complaints: number;
  warnings: number;
};

export function restaurantScore(m: RestaurantMetrics): Score {
  return total(
    [
      ratingPart(40, m.ratingAvg, m.ratingCount),
      m.received
        ? { key: "accept", label: "Commandes acceptées", points: 25 * (1 - m.refused / m.received), max: 25, detail: `${m.received - m.refused} sur ${m.received}` }
        : { key: "accept", label: "Commandes acceptées", points: 19, max: 25, detail: "aucune commande" },
      m.timed
        ? { key: "prep", label: "Préparation à l'heure", points: 15 * (m.onTime / m.timed), max: 15, detail: `${m.onTime} sur ${m.timed} (${pct(m.onTime / m.timed)})` }
        : { key: "prep", label: "Préparation à l'heure", points: 11, max: 15, detail: "pas encore mesurée" },
      complaintsPart(20, m.complaints, m.warnings),
    ],
    m.received,
  );
}

export type MerchantMetrics = {
  sent: number;
  delivered: number;
  cancelled: number;
  sentLast30: number;
  complaints: number;
  warnings: number;
};

export function merchantScore(m: MerchantMetrics): Score {
  const closed = m.delivered + m.cancelled;
  return total(
    [
      closed
        ? { key: "done", label: "Colis livrés", points: 60 * (m.delivered / closed), max: 60, detail: `${m.delivered} sur ${closed}` }
        : { key: "done", label: "Colis livrés", points: 45, max: 60, detail: "aucun colis terminé" },
      { key: "activity", label: "Envois réguliers", points: 20 * clamp(m.sentLast30 / 8), max: 20, detail: `${m.sentLast30} envoi${m.sentLast30 > 1 ? "s" : ""} en 30 jours` },
      complaintsPart(20, m.complaints, m.warnings),
    ],
    m.sent,
  );
}

// Groupes automatiques, calculés à chaque lecture (rien n'est stocké).
export const SEGMENTS = {
  TOP: "Meilleurs",
  WATCH: "À surveiller",
  NEW: "Nouveaux",
  INACTIVE: "Inactifs",
  VIP: "VIP",
  LOYAL: "Fidèles",
  DORMANT: "Endormis",
} as const;
export type Segment = keyof typeof SEGMENTS;

export const CUSTOMER_SEGMENT_RULES: Partial<Record<Segment, string>> = {
  VIP: "10 commandes livrées ou plus en 60 jours",
  LOYAL: "3 commandes livrées ou plus en 30 jours",
  NEW: "1re commande il y a moins de 14 jours",
  DORMANT: "3 commandes ou plus, mais plus rien depuis 21 jours",
  WATCH: `score sous ${WATCH_BELOW} (refus à la porte, litiges, plaintes)`,
};

const DAY = 86_400_000;

export function segmentsFor(
  type: CrmType,
  input: { score: number | null; createdAt: Date | null; lastActivityAt: Date | null; delivered30?: number; delivered60?: number; ordersAllTime?: number },
  now = Date.now(),
): Segment[] {
  const out: Segment[] = [];
  const since = (d: Date | null) => (d ? (now - d.getTime()) / DAY : Infinity);
  if (input.score !== null && input.score < WATCH_BELOW) out.push("WATCH");
  if (type === "CUSTOMER") {
    if ((input.delivered60 ?? 0) >= 10) out.push("VIP");
    else if ((input.delivered30 ?? 0) >= 3) out.push("LOYAL");
    if (since(input.createdAt) < 14) out.push("NEW");
    if ((input.ordersAllTime ?? 0) >= 3 && since(input.lastActivityAt) > 21) out.push("DORMANT");
    return out;
  }
  if (input.score !== null && input.score >= 85) out.push("TOP");
  if (since(input.createdAt) < 30) out.push("NEW");
  if (since(input.lastActivityAt) > 14) out.push("INACTIVE");
  return out;
}

export function scoreColor(value: number | null): "green" | "orange" | "red" | "grey" {
  if (value === null) return "grey";
  if (value >= GOOD_FROM) return "green";
  if (value >= WATCH_BELOW) return "orange";
  return "red";
}
