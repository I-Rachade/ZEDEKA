import { notFound } from "next/navigation";
import { apiGet, fcfa, lineLabel, type OrderStatus, type OrderSummary } from "@/lib/api";

const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Reçue, en attente de confirmation",
  CONFIRMED: "Confirmée, en préparation",
  PICKED_UP: "En route avec le livreur",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
};

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const order = await apiGet<OrderSummary>(`/api/orders/${encodeURIComponent(code)}`);
  if (!order) notFound();

  return (
    <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
      <div>
        <h1 className="text-xl font-semibold">Commande {order.code}</h1>
        <p className="text-sm text-stone-600">
          {order.type === "PARCEL" ? "Colis" : order.restaurant?.name}
          {order.fulfillment === "PICKUP" && " · à emporter"}
        </p>
      </div>
      <p className="rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">{STATUS_LABEL[order.status]}</p>
      <ul className="space-y-1 text-sm">
        {order.items.map((i) => (
          <li key={`${i.name}-${i.variantName}-${i.addons.length}`} className="flex justify-between">
            <span>
              {i.quantity} × {lineLabel(i)}
            </span>
            <span>{fcfa(i.unitPrice * i.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1 border-t border-stone-100 pt-3 text-sm">
        {order.discount > 0 && (
          <div className="flex justify-between">
            <dt>Remise</dt>
            <dd>− {fcfa(order.discount)}</dd>
          </div>
        )}
        <div className="flex justify-between">
          <dt>Livraison ({order.zone.name})</dt>
          <dd>{fcfa(order.deliveryFee)}</dd>
        </div>
        {order.extraFee > 0 && (
          <div className="flex justify-between">
            <dt>Supplément</dt>
            <dd>{fcfa(order.extraFee)}</dd>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold">
          <dt>Total</dt>
          <dd>{fcfa(order.total)}</dd>
        </div>
      </dl>
    </div>
  );
}
