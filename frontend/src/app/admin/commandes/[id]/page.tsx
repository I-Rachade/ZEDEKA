"use client";

import { use, useState } from "react";
import { fcfa, lineLabel } from "@/lib/api";
import {
  adminFetch,
  formatTime,
  NEXT_STATUS,
  orderTitle,
  STATUS_LABEL,
  type AdminOrder,
  type AdminOrderStatus,
  type Driver,
} from "@/lib/admin";
import { button, buttonGhost, Card, ErrorNote, input, Loading, StatusBadge } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "text-base font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
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
  const next = NEXT_STATUS[o.status];
  const patch = (body: Record<string, unknown>) =>
    action.run(async () => {
      await adminFetch(`/orders/${id}`, { method: "PATCH", body });
      await reload();
    });

  const timeline: [AdminOrderStatus, string | null][] = [
    ["PENDING", o.createdAt],
    ["CONFIRMED", o.confirmedAt],
    ["PICKED_UP", o.pickedUpAt],
    ["DELIVERED", o.deliveredAt],
    ["CANCELLED", o.cancelledAt],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Commande {o.code}</h1>
          <p className="text-sm text-stone-500">{orderTitle(o)}</p>
        </div>
        <StatusBadge status={o.status} />
      </div>
      <div className="print:hidden">
        <ErrorNote message={action.error} />
      </div>

      {open && (
        <div className="print:hidden">
        <Card title="Traitement">
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {o.fulfillment === "DELIVERY" && (
              <select
                aria-label="Livreur"
                value={o.driver?.id ?? ""}
                onChange={(e) => patch({ driverId: e.target.value || null })}
                className={`${input} w-auto`}
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
            {next && (
              <button onClick={() => patch({ status: next })} className={button}>
                Passer à « {STATUS_LABEL[next]} »
              </button>
            )}
            <button onClick={() => setCancelling((c) => !c)} className="px-2 py-2 text-sm text-red-700">
              Annuler la commande
            </button>
          </div>
          {cancelling && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                patch({ status: "CANCELLED", cancellationReason: new FormData(e.currentTarget).get("reason") });
              }}
              className="mt-3 flex flex-wrap gap-2"
            >
              <input name="reason" required minLength={3} placeholder="Motif (ex. client injoignable)" className={`${input} flex-1`} />
              <button className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white">Confirmer l&apos;annulation</button>
            </form>
          )}
        </Card>
        </div>
      )}

      <div id="facture" className="space-y-4">
        <Card title={`Facture ${o.code}`} action={<button onClick={() => window.print()} className={`${buttonGhost} print:hidden`}>Imprimer</button>}>
          <p className="mb-3 hidden text-sm print:block">Zedeka · livraison et repas à Lomé</p>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="font-medium">{o.type === "PARCEL" ? "Expéditeur" : "Client"}</p>
              <p>{o.customerName}</p>
              <p>{o.customerPhone}</p>
              {o.type === "FOOD" && <p>{o.address}</p>}
              {o.pickupAddress && <p>Retrait : {o.pickupAddress}</p>}
            </div>
            {o.type === "PARCEL" ? (
              <div>
                <p className="font-medium">Destinataire</p>
                <p>{o.recipientName}</p>
                <p>{o.recipientPhone}</p>
                <p>{o.address}</p>
                <p className="text-stone-500">
                  {o.parcelCategory?.name}
                  {o.weightKg !== null && ` · ${o.weightKg} kg`}
                </p>
              </div>
            ) : (
              <div>
                <p className="font-medium">Restaurant</p>
                <p>{o.restaurant?.name}</p>
                <p>{o.restaurant?.phone}</p>
                <p className="text-stone-500">{o.fulfillment === "PICKUP" ? "À emporter" : `Livraison · ${o.zone.name}`}</p>
              </div>
            )}
          </div>

          {o.items.length > 0 && (
            <table className="mt-4 w-full text-sm">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 font-normal">Article</th>
                  <th className="py-1 text-right font-normal">Qté</th>
                  <th className="py-1 text-right font-normal">Prix</th>
                  <th className="py-1 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i, n) => (
                  <tr key={n} className="border-t border-stone-100">
                    <td className="py-1">{lineLabel(i)}</td>
                    <td className="py-1 text-right">{i.quantity}</td>
                    <td className="py-1 text-right">{fcfa(i.unitPrice)}</td>
                    <td className="py-1 text-right">{fcfa(i.unitPrice * i.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <p className="mt-3 text-xs text-stone-500">Commande du {formatTime(o.createdAt)}</p>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 print:hidden">
        <Card title="Ajuster les montants">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              patch({ discount: Number(f.get("discount")), extraFee: Number(f.get("extraFee")) });
            }}
            className="space-y-2 text-sm"
          >
            <label className="flex items-center justify-between gap-2">
              Remise (FCFA)
              <input name="discount" type="number" min={0} step={50} defaultValue={o.discount} disabled={!open} className={`${input} w-28`} />
            </label>
            <label className="flex items-center justify-between gap-2">
              Supplément (FCFA)
              <input name="extraFee" type="number" min={0} step={50} defaultValue={o.extraFee} disabled={!open} className={`${input} w-28`} />
            </label>
            {open && <button className={buttonGhost}>Recalculer le total</button>}
          </form>
          <div className="mt-3 border-t border-stone-100 pt-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={o.paymentStatus === "PAID"}
                onChange={(e) => patch({ paymentStatus: e.target.checked ? "PAID" : "UNPAID" })}
              />
              Paiement reçu
            </label>
          </div>
        </Card>

        <Card title="Suivi">
          <ol className="space-y-1 text-sm">
            {timeline
              .filter(([, at]) => at)
              .map(([s, at]) => (
                <li key={s} className="flex justify-between">
                  <span>{STATUS_LABEL[s]}</span>
                  <span className="text-stone-500">{formatTime(at!)}</span>
                </li>
              ))}
          </ol>
          {o.driver && (
            <p className="mt-2 text-sm">
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
          <dl className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-xs text-stone-600">
            <Row label="Commission Zedeka" value={fcfa(o.commission)} />
            <Row label="Part du livreur" value={fcfa(o.driverEarning)} />
          </dl>
          {o.latitude !== null && o.longitude !== null && (
            <a
              href={`https://www.google.com/maps?q=${o.latitude},${o.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm text-emerald-700 underline"
            >
              Voir la position du client
            </a>
          )}
          {o.note && <p className="mt-2 text-sm italic">Note : {o.note}</p>}
        </Card>
      </div>
    </div>
  );
}
