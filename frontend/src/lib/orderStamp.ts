import type { OrderSummary } from "@/lib/api";

// Empreinte de ce que la page de suivi affiche : si elle change, la page est rendue à nouveau.
export function orderStamp(o: OrderSummary): string {
  return [
    o.status,
    o.confirmedAt,
    o.preparingAt,
    o.prepMinutes,
    o.readyAt,
    o.pickedUpAt,
    o.handedOverAt,
    o.deliveredAt,
    o.cancelledAt,
    o.driver?.firstName,
    o.awaitingPosition,
    o.locationStatus,
    o.total,
    o.edits?.length,
  ]
    .map((v) => (v == null ? "" : String(v)))
    .join("|");
}
