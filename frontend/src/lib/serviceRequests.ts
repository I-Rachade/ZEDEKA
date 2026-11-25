// Demandes de service (courses, gaz et eau, lessive, ménage, dépannage) : types partagés par l'appli client,
// l'appli livreur et l'admin. Le serveur (backend/src/serviceRequests.ts) calcule le prix et valide tout.

export type RequestModule = "ERRAND" | "GAS" | "LAUNDRY" | "CLEANING" | "REPAIR";
export type RequestStatus = "PENDING" | "ACCEPTED" | "ON_THE_WAY" | "IN_PROGRESS" | "DONE" | "CANCELLED";
export const REQUEST_MODULES: RequestModule[] = ["ERRAND", "GAS", "LAUNDRY", "CLEANING", "REPAIR"];
export const isRequestModule = (code: string): code is RequestModule => (REQUEST_MODULES as string[]).includes(code);
export const NEEDS_SLOT: RequestModule[] = ["LAUNDRY", "CLEANING", "REPAIR"];
export const OPEN_STATUSES: RequestStatus[] = ["PENDING", "ACCEPTED", "ON_THE_WAY", "IN_PROGRESS"];

export const MODULE_EMOJI: Record<RequestModule, string> = { ERRAND: "🛒", GAS: "🔥", LAUNDRY: "🧺", CLEANING: "🧹", REPAIR: "🔧" };

export type ServiceRequest = {
  id: string;
  code: string;
  module: RequestModule;
  status: RequestStatus;
  statusLabel: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  details: Record<string, unknown>;
  summary: string;
  note: string | null;
  scheduledFor: string | null;
  estimate: number;
  extra: number | null;
  finalPrice: number | null;
  acceptedAt: string | null;
  onTheWayAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  rating: number | null;
  ratingComment: string | null;
  createdAt: string;
  provider?: { id?: string; name: string; phone: string | null } | null;
  customer?: { name: string | null; phone: string } | null;
};

// Étapes de la barre de suivi (client et prestataire).
export const STEPS: { status: RequestStatus; label: string }[] = [
  { status: "PENDING", label: "Envoyée" },
  { status: "ACCEPTED", label: "Acceptée" },
  { status: "ON_THE_WAY", label: "En route" },
  { status: "IN_PROGRESS", label: "En cours" },
  { status: "DONE", label: "Terminée" },
];
export const stepIndex = (s: RequestStatus) => STEPS.findIndex((x) => x.status === s);

export const STATUS_TEXT: Record<RequestStatus, string> = {
  PENDING: "Recherche d'un prestataire",
  ACCEPTED: "Prestataire trouvé",
  ON_THE_WAY: "En route",
  IN_PROGRESS: "En cours",
  DONE: "Terminée",
  CANCELLED: "Annulée",
};

export const STATUS_COLOR: Record<RequestStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900",
  ACCEPTED: "bg-sky-100 text-sky-900",
  ON_THE_WAY: "bg-sky-100 text-sky-900",
  IN_PROGRESS: "bg-emerald-100 text-emerald-900",
  DONE: "bg-stone-100 text-stone-700",
  CANCELLED: "bg-stone-200 text-stone-600",
};

// Ce que l'estimation ne couvre pas : payé par le prestataire et remboursé à la fin.
export const EXTRA_NOTE: Record<RequestModule, string | null> = {
  ERRAND: "Les achats sont remboursés au livreur sur le ticket de caisse.",
  GAS: "Le prix du gaz ou de l'eau est payé en plus, au prix de la boutique.",
  LAUNDRY: null,
  CLEANING: "Produits de ménage fournis par vous.",
  REPAIR: "Prix du déplacement et du diagnostic. Les pièces et la réparation sont annoncées sur place avant les travaux.",
};

// Lomé vit à l'heure UTC : le créneau choisi est envoyé tel quel en UTC.
export const slotIso = (date: string, time: string) => `${date}T${time}:00Z`;
export const slotLabel = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });

// Créneaux de 7 h à 19 h, toutes les 30 minutes.
export const SLOT_TIMES = Array.from({ length: 25 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
