// Libellés partagés par la liste et la fiche des candidatures.

export type ApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";
export const APPLICATION_LABEL: Record<ApplicationStatus, string> = { PENDING: "À examiner", APPROVED: "Validée", REJECTED: "Refusée" };
const COLOR: Record<ApplicationStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-stone-200 text-stone-600",
};
export const ApplicationPill = ({ status }: { status: ApplicationStatus }) => (
  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLOR[status]}`}>{APPLICATION_LABEL[status]}</span>
);
export const BUSINESS_LABEL: Record<string, string> = {
  restaurant: "Restaurant",
  fast_food: "Fast-food",
  patisserie: "Pâtisserie",
  epicerie: "Épicerie",
  pharmacie: "Pharmacie",
  boutique: "Boutique",
};
