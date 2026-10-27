export type OrderStatus = "PENDING" | "CONFIRMED" | "PREPARING" | "READY" | "PICKED_UP" | "DELIVERED" | "CANCELLED";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Nouvelle",
  CONFIRMED: "Acceptée",
  PREPARING: "En préparation",
  READY: "Prête",
  PICKED_UP: "En livraison",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

const STATUS_COLOR: Record<OrderStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  CONFIRMED: "bg-sky-100 text-sky-800",
  PREPARING: "bg-orange-100 text-orange-800",
  READY: "bg-lime-100 text-lime-800",
  PICKED_UP: "bg-violet-100 text-violet-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-stone-200 text-stone-600",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>;
}
