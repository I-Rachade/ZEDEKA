"use client";

import { use, useState } from "react";
import { fcfa, lineLabel } from "@/lib/api";
import { adminFetch, formatTime, nextStatus, orderTitle, STATUS_LABEL, type AdminOrder, type AdminOrderStatus, type Driver } from "@/lib/admin";
import { Icon } from "@/components/panel/icons";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatusBadge } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-base font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: o, error, reload } = useAdmin<AdminOrder>(`/orders/${id}`);
  const drivers = useAdmin<Driver[]>("/drivers");
  const action = useAction();
  const [cancelling, setCancelling] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!o) return <Loading />;

  const open = o.status !== "DELIVERED" && o.status !== "CANCELLED";
  const next = nextStatus(o);
  const patch = (body: Record<string, unknown>) =>
    action.run(async () => {
      await adminFetch(`/orders/${id}`, { method: "PATCH", body });
      await reload();
    });

  const timeline: [AdminOrderStatus, string | null][] = [
    ["PENDING", o.createdAt],
    ["CONFIRMED", o.confirmedAt],
    ["PREPARING", o.preparingAt],
    ["READY", o.readyAt],
    ["PICKED_UP", o.pickedUpAt],
    ["DELIVERED", o.deliveredAt],
    ["CANCELLED", o.cancelledAt],
  ];

  return (
    <div>
      <PageHeader
        icon={o.type === "PARCEL" ? "box" : "orders"}
        title={`Commande ${o.code}`}
        description={`${orderTitle(o)} · ${formatTime(o.createdAt)}${o.fulfillment === "PICKUP" ? " · à emporter" : ""}`}
        actions={
          <>
            <StatusBadge status={o.status} />
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> Facture
            </button>
            {open && next && (
              <button onClick={() => patch({ status: next })} className={button}>
                <Icon name="check" className="h-4 w-4" /> {STATUS_LABEL[next]}
              </button>
            )}
          </>
        }
      />
      <div className="mb-3 print:hidden">
        <ErrorNote message={action.error} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div id="facture" className="space-y-4 lg:col-span-2">
          <Card title={`Facture ${o.code}`} icon="receipt">
            <p className="mb-3 hidden text-sm print:block">Zedeka · livraison et repas à Lomé · {formatTime(o.createdAt)}</p>
            {o.items.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-1 font-medium">Article</th>
                    <th className="py-1 text-right font-medium">Qté</th>
                    <th className="py-1 text-right font-medium">Prix</th>
                    <th className="py-1 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {o.items.map((i, n) => (
                    <tr key={n} className="border-t border-stone-100">
                      <td className="py-1.5">{lineLabel(i)}</td>
                      <td className="py-1.5 text-right">{i.quantity}</td>
                      <td className="py-1.5 text-right">{fcfa(i.unitPrice)}</td>
                      <td className="py-1.5 text-right">{fcfa(i.unitPrice * i.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {o.type === "PARCEL" && (
              <p className="text-sm">
                Colis {o.parcelCategory?.name}
                {o.weightKg !== null && ` · ${o.weightKg} kg`}
              </p>
            )}
            <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
              {o.type === "FOOD" && <Row label="Sous-total" value={fcfa(o.subtotal)} />}
              {o.discount > 0 && <Row label="Remise" value={`− ${fcfa(o.discount)}`} />}
              <Row label={`Livraison${o.distanceKm !== null ? ` (${o.distanceKm} km)` : ""}`} value={fcfa(o.deliveryFee)} />
              {o.extraFee > 0 && <Row label="Supplément" value={fcfa(o.extraFee)} />}
              <Row label="Total" value={fcfa(o.total)} strong />
              <Row
                label="Paiement"
                value={`${o.paymentMethod === "CASH" ? "Espèces" : "Mobile money"} · ${o.paymentStatus === "PAID" ? "payé" : "non payé"}`}
              />
            </dl>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card title={o.type === "PARCEL" ? "Expéditeur" : "Client"} icon="user">
              <div className="space-y-0.5 text-sm">
                <p>{o.customerName}</p>
                <a href={`tel:${o.customerPhone.replace(/ /g, "")}`} className="text-emerald-700">
                  {o.customerPhone}
                </a>
                {o.pickupAddress && <p>Retrait : {o.pickupAddress}</p>}
                {o.type === "FOOD" && <p>{o.address}</p>}
                {o.latitude !== null && o.longitude !== null && (
                  <a href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`} target="_blank" rel="noopener noreferrer" className="block text-emerald-700 underline print:hidden">
                    Voir la position
                  </a>
                )}
                {o.note && <p className="italic text-stone-600">Note : {o.note}</p>}
              </div>
            </Card>
            {o.type === "PARCEL" ? (
              <Card title="Destinataire" icon="map">
                <div className="space-y-0.5 text-sm">
                  <p>{o.recipientName}</p>
                  <p>{o.recipientPhone}</p>
                  <p>{o.address}</p>
                  <p className="text-stone-500">{o.zone.name}</p>
                </div>
              </Card>
            ) : (
              <Card title="Restaurant" icon="store">
                <div className="space-y-0.5 text-sm">
                  <p>{o.restaurant?.name}</p>
                  <p>{o.restaurant?.phone}</p>
                  <p className="text-stone-500">{o.fulfillment === "PICKUP" ? "À emporter" : `Livraison · ${o.zone.name}`}</p>
                  {o.prepMinutes && <p className="text-stone-500">Préparation annoncée : {o.prepMinutes} min</p>}
                </div>
              </Card>
            )}
          </div>
        </div>

        <div className="space-y-4 print:hidden">
          {open && (
            <Card title="Traitement" icon="dispatch">
              {o.fulfillment === "DELIVERY" && (
                <select
                  aria-label="Livreur"
                  value={o.driver?.id ?? ""}
                  onChange={(e) => patch({ driverId: e.target.value || null })}
                  className={input}
                >
                  <option value="">Choisir un livreur</option>
                  {drivers.data
                    ?.filter((d) => (d.active && d.status === "APPROVED") || d.id === o.driver?.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} {d.online ? "· en ligne" : ""} ({d.ordersToday ?? 0} aujourd&apos;hui)
                      </option>
                    ))}
                </select>
              )}
              <button onClick={() => setCancelling((c) => !c)} className="mt-2 text-sm text-red-700">
                Annuler la commande
              </button>
              {cancelling && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    patch({ status: "CANCELLED", cancellationReason: new FormData(e.currentTarget).get("reason") });
                  }}
                  className="mt-2 space-y-2"
                >
                  <input name="reason" required minLength={3} placeholder="Motif (ex. client injoignable)" className={input} />
                  <button className={buttonDanger}>Confirmer l&apos;annulation</button>
                </form>
              )}
            </Card>
          )}

          <Card title="Suivi" icon="clock">
            <ol className="space-y-1.5 text-sm">
              {timeline
                .filter(([, at]) => at)
                .map(([s, at]) => (
                  <li key={s} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${s === "CANCELLED" ? "bg-red-500" : "bg-emerald-500"}`} />
                      {STATUS_LABEL[s]}
                    </span>
                    <span className="text-stone-500">{formatTime(at!)}</span>
                  </li>
                ))}
            </ol>
            {o.driver && (
              <p className="mt-3 text-sm">
                Livreur : {o.driver.name},{" "}
                <a href={`tel:${o.driver.phone.replace(/ /g, "")}`} className="text-emerald-700">
                  {o.driver.phone}
                </a>
              </p>
            )}
            {o.cancellationReason && (
              <p className="mt-2 text-sm text-red-700">
                Annulée : {o.cancellationReason}
                {o.cancellationFee > 0 && ` · frais retenus ${fcfa(o.cancellationFee)}`}
              </p>
            )}
          </Card>

          <Card title="Montants" icon="wallet">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                patch({ discount: Number(f.get("discount")), extraFee: Number(f.get("extraFee")) });
              }}
              className="space-y-2 text-sm"
            >
              <label className="flex items-center justify-between gap-2">
                Remise
                <input name="discount" type="number" min={0} step={50} defaultValue={o.discount} disabled={!open} className={`${input} w-28`} />
              </label>
              <label className="flex items-center justify-between gap-2">
                Supplément
                <input name="extraFee" type="number" min={0} step={50} defaultValue={o.extraFee} disabled={!open} className={`${input} w-28`} />
              </label>
              {open && <button className={buttonGhost}>Recalculer le total</button>}
            </form>
            <label className="mt-3 flex items-center gap-2 border-t border-stone-100 pt-3 text-sm">
              <input
                type="checkbox"
                checked={o.paymentStatus === "PAID"}
                onChange={(e) => patch({ paymentStatus: e.target.checked ? "PAID" : "UNPAID" })}
              />
              Paiement reçu
            </label>
            <dl className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-xs text-stone-600">
              <Row label="Commission Zedeka" value={fcfa(o.commission)} />
              <Row label="Part du livreur" value={fcfa(o.driverEarning)} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
