"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { STATUS_LABEL, StatusPill, type OrderStatus } from "@/components/panel/status";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import { restaurantFetch, type RestaurantOrder } from "@/lib/restaurant";
import { ordersChanged } from "../../useNewOrders";
import { useRestaurant, useRestaurantAction } from "../../useRestaurant";

const REASONS = ["Plat épuisé", "Trop de commandes en cours", "Fermeture imminente"];

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-base font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export default function RestaurantOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: o, error, reload } = useRestaurant<RestaurantOrder>(`/orders/${id}`);
  const action = useRestaurantAction();
  const [minutes, setMinutes] = useState("20");
  const [refusing, setRefusing] = useState(false);

  if (error) return <ErrorNote message={error} />;
  if (!o) return <Loading />;

  const move = (status: OrderStatus, extra: { prepMinutes?: number; reason?: string } = {}) =>
    action.run(async () => {
      await restaurantFetch(`/orders/${id}/status`, { method: "POST", body: { status, ...extra } });
      await reload();
      ordersChanged();
    });
  const prep = Number(minutes) > 0 ? { prepMinutes: Number(minutes) } : {};

  // Action principale proposée en haut à droite, selon l'étape.
  const main =
    o.status === "PENDING" ? (
      <button onClick={() => move(prep.prepMinutes ? "PREPARING" : "CONFIRMED", prep)} className={button}>
        <Icon name="check" className="h-4 w-4" /> Accepter
      </button>
    ) : o.status === "CONFIRMED" ? (
      <button onClick={() => move("PREPARING", prep)} className={button}>
        <Icon name="fire" className="h-4 w-4" /> Lancer la préparation
      </button>
    ) : o.status === "PREPARING" ? (
      <button onClick={() => move("READY")} className={button}>
        <Icon name="bag" className="h-4 w-4" /> Commande prête
      </button>
    ) : null;

  const timeline: [OrderStatus, string | null][] = [
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
        icon="orders"
        title={`Commande ${o.code}`}
        description={`${formatTime(o.createdAt)} · ${o.fulfillment === "PICKUP" ? "à emporter, le client vient la chercher" : "livrée par un livreur Zedeka"}`}
        actions={
          <>
            <StatusPill status={o.status} />
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> Bon de commande
            </button>
            {main}
          </>
        }
      />
      <div className="mb-3 print:hidden">
        <ErrorNote message={action.error} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Bon ${o.code}`} icon="receipt">
            <p className="mb-3 hidden text-sm print:block">
              {o.restaurant?.name} · {formatTime(o.createdAt)} · {o.fulfillment === "PICKUP" ? "À emporter" : "Livraison Zedeka"}
            </p>
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
                  <tr key={n} className="border-t border-stone-100 align-top">
                    <td className="py-1.5">
                      <span className="font-medium">{i.name}</span>
                      {i.variantName && <span className="block text-stone-600">{i.variantName}</span>}
                      {i.addons.map((a) => (
                        <span key={a.name} className="block text-stone-600">
                          + {a.name} ({fcfa(a.price)})
                        </span>
                      ))}
                    </td>
                    <td className="py-1.5 text-right text-base font-semibold">{i.quantity}</td>
                    <td className="py-1.5 text-right">{fcfa(i.unitPrice)}</td>
                    <td className="py-1.5 text-right">{fcfa(i.unitPrice * i.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {o.note && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">Note du client : {o.note}</p>}
            <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
              <Row label="Sous-total des plats" value={fcfa(o.subtotal)} />
              <Row label="Commission Zedeka" value={`− ${fcfa(o.commission)}`} />
              <Row label="Pour le restaurant" value={fcfa(o.subtotal - o.commission)} strong />
              <Row
                label="Paiement client"
                value={`${o.paymentMethod === "CASH" ? "Espèces" : "Mobile money"} · ${o.paymentStatus === "PAID" ? "payé" : "non payé"} · ${fcfa(o.total)}`}
              />
            </dl>
          </Card>

          <Card title="Client" icon="user">
            <div className="space-y-0.5 text-sm">
              <p>{o.customerName}</p>
              <a href={`tel:${o.customerPhone.replace(/ /g, "")}`} className="text-emerald-700">
                {o.customerPhone}
              </a>
              {o.fulfillment === "DELIVERY" && <p className="text-stone-600">{o.address} · {o.zone.name}</p>}
            </div>
          </Card>
        </div>

        <div className="space-y-4 print:hidden">
          {(o.status === "PENDING" || o.status === "CONFIRMED") && (
            <Card title={o.status === "PENDING" ? "Accepter ou refuser" : "Préparation"} icon="clock">
              <label className="block text-sm">
                Temps de préparation (minutes, facultatif)
                <input type="number" min={1} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} className={`${input} mt-1`} />
              </label>
              <div className="mt-2 flex flex-wrap gap-1">
                {[10, 20, 30, 45].map((m) => (
                  <button key={m} onClick={() => setMinutes(String(m))} className={`rounded-full border px-2.5 py-0.5 text-xs ${minutes === String(m) ? "border-emerald-600 bg-emerald-50" : "border-stone-300"}`}>
                    {m} min
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{main}</div>
              {o.status === "CONFIRMED" && (
                <button onClick={() => move("READY")} className={`${buttonGhost} mt-2`}>
                  Déjà prête
                </button>
              )}
              {o.status === "PENDING" && (
                <>
                  <button onClick={() => setRefusing((r) => !r)} className="mt-3 block text-sm text-red-700">
                    Refuser la commande
                  </button>
                  {refusing && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        move("CANCELLED", { reason: String(new FormData(e.currentTarget).get("reason") ?? "") });
                      }}
                      className="mt-2 space-y-2"
                    >
                      <input name="reason" list="refus" required minLength={3} placeholder="Motif du refus" className={input} />
                      <datalist id="refus">
                        {REASONS.map((r) => (
                          <option key={r} value={r} />
                        ))}
                      </datalist>
                      <button className={buttonDanger}>Confirmer le refus</button>
                    </form>
                  )}
                </>
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
            {o.prepMinutes && <p className="mt-2 text-sm text-stone-600">Préparation annoncée : {o.prepMinutes} min</p>}
            {o.status === "READY" && o.fulfillment === "DELIVERY" && (
              <p className="mt-2 text-sm text-stone-600">{o.driver ? `Livreur en route : ${o.driver.name}, ${o.driver.phone}` : "Zedeka assigne un livreur."}</p>
            )}
            {o.cancellationReason && <p className="mt-2 text-sm text-red-700">Annulée : {o.cancellationReason}</p>}
          </Card>

          <Link href="/restaurant/commandes" className="block text-sm text-emerald-700">
            ← Toutes les commandes
          </Link>
        </div>
      </div>
    </div>
  );
}
