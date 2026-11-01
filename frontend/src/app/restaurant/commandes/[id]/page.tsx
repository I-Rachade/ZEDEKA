"use client";

import Link from "next/link";
import { use, useState } from "react";
import { Icon } from "@/components/panel/icons";
import StatusStepper from "@/components/panel/StatusStepper";
import { StatusPill, type OrderStatus } from "@/components/panel/status";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { formatTime, orderSteps } from "@/lib/admin";
import { restaurantFetch, type RestaurantOrder } from "@/lib/restaurant";
import { ordersChanged } from "../../useNewOrders";
import { useRestaurant, useRestaurantAction } from "../../useRestaurant";
import OrderEditor from "./OrderEditor";
import { useT } from "@/lib/i18n/client";

const REASONS = ["Plat épuisé", "Trop de commandes en cours", "Fermeture imminente"];

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useT();
  return (
    <div className={`flex justify-between gap-2 ${strong ? "text-base font-semibold" : ""}`}>
      <dt>{t(label)}</dt>
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
  const t = useT();

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
        <Icon name="check" className="h-4 w-4" /> {t("Accepter")}
      </button>
    ) : o.status === "CONFIRMED" ? (
      <button onClick={() => move("PREPARING", prep)} className={button}>
        <Icon name="fire" className="h-4 w-4" /> {t("Lancer la préparation")}
      </button>
    ) : o.status === "PREPARING" ? (
      <button onClick={() => move("READY")} className={button}>
        <Icon name="bag" className="h-4 w-4" /> {t("Commande prête")}
      </button>
    ) : o.status === "READY" && o.tableNumber != null ? (
      // Sur place : le restaurant apporte la commande à la table, puis la clôture.
      <button onClick={() => move("DELIVERED")} className={button}>
        <Icon name="check" className="h-4 w-4" /> {t("Servie à la table {number}", { number: o.tableNumber })}
      </button>
    ) : o.status === "READY" && o.fulfillment === "PICKUP" ? (
      // Retrait : pas de livreur, le restaurant clôture la commande en la remettant au client (payée au comptoir).
      <button onClick={() => move("DELIVERED")} className={button}>
        <Icon name="check" className="h-4 w-4" /> {t("Remis au client")}
      </button>
    ) : null;


  return (
    <div>
      <PageHeader
        icon="orders"
        title={t("Commande {code}", { code: o.code })}
        description={`${formatTime(o.createdAt)} · ${o.tableNumber != null ? t("sur place, à apporter à la table {number}", { number: o.tableNumber }) : o.fulfillment === "PICKUP" ? t("à emporter, le client vient la chercher") : t("livrée par un livreur Zedeka")}`}
        actions={
          <>
            <StatusPill status={o.status} />
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> {t("Bon de commande")}
            </button>
            {main}
          </>
        }
      />
      <div className="mb-3 print:hidden">
        <ErrorNote message={action.error} />
      </div>

      {o.tableNumber != null && (
        // Bien visible (et sur le bon imprimé) : la cuisine sait à quelle table apporter la commande.
        <div className="mb-4 flex items-center gap-4 rounded-xl border-2 border-emerald-600 bg-emerald-50 p-4">
          <span className="grid h-16 min-w-16 place-items-center rounded-xl bg-emerald-600 px-3 text-3xl font-extrabold text-white">{o.tableNumber}</span>
          <div>
            <p className="text-lg font-bold text-emerald-900">{t("Table {number}", { number: o.tableNumber })}</p>
            <p className="text-sm text-emerald-900">{t("Commande sur place : apportez-la à la table, sans livreur.")}</p>
          </div>
        </div>
      )}

      <Card className="mb-4 print:hidden">
        <StatusStepper
          steps={orderSteps(o)}
          stopped={o.status === "CANCELLED" ? { label: "Annulée", at: o.cancelledAt } : undefined}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t("Bon {code}", { code: o.code })} icon="receipt">
            <p className="mb-3 hidden text-sm print:block">
              {o.restaurant?.name} · {formatTime(o.createdAt)} · {o.tableNumber != null ? t("Table {number}", { number: o.tableNumber }) : o.fulfillment === "PICKUP" ? t("À emporter") : t("Livraison Zedeka")}
            </p>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-1 font-medium">{t("Article")}</th>
                  <th className="py-1 text-right font-medium">{t("Qté")}</th>
                  <th className="py-1 text-right font-medium">{t("Prix")}</th>
                  <th className="py-1 text-right font-medium">{t("Total")}</th>
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
            {o.note && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{t("Note du client :")} {o.note}</p>}
            <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
              <Row label="Sous-total des plats" value={fcfa(o.subtotal)} />
              {o.commission > 0 && <Row label="Commission Zedeka" value={`− ${fcfa(o.commission)}`} />}
              <Row label="Pour le restaurant" value={fcfa(o.subtotal - o.commission)} strong />
              <Row
                label="Paiement client"
                value={`${o.paymentMethod === "CASH" ? t("Espèces") : t("Mobile money")} · ${o.paymentStatus === "PAID" ? t("payé") : t("non payé")} · ${fcfa(o.total)}`}
              />
            </dl>
          </Card>

          <Card title="Client" icon="user">
            <div className="space-y-0.5 text-sm">
              <p>{o.customerName}</p>
              {o.customerPhone && (
                <a href={`tel:${o.customerPhone.replace(/ /g, "")}`} className="text-emerald-700">
                  {o.customerPhone}
                </a>
              )}
              {o.fulfillment === "DELIVERY" && <p className="text-stone-600">{o.address} · {o.zone.name}</p>}
            </div>
          </Card>
        </div>

        <div className="space-y-4 print:hidden">
          {(o.status === "PENDING" || o.status === "CONFIRMED") && (
            <Card title={o.status === "PENDING" ? "Accepter ou refuser" : "Préparation"} icon="clock">
              <label className="block text-sm">
                {t("Temps de préparation (minutes, facultatif)")}
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
                  {t("Déjà prête")}
                </button>
              )}
              {o.status === "PENDING" && (
                <>
                  <button onClick={() => setRefusing((r) => !r)} className="mt-3 block text-sm text-red-700">
                    {t("Refuser la commande")}
                  </button>
                  {refusing && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        move("CANCELLED", { reason: String(new FormData(e.currentTarget).get("reason") ?? "") });
                      }}
                      className="mt-2 space-y-2"
                    >
                      <input name="reason" list="refus" required minLength={3} placeholder={t("Motif du refus")} className={input} />
                      <datalist id="refus">
                        {REASONS.map((r) => (
                          <option key={r} value={t(r)} />
                        ))}
                      </datalist>
                      <button className={buttonDanger}>{t("Confirmer le refus")}</button>
                    </form>
                  )}
                </>
              )}
            </Card>
          )}

          <OrderEditor
            order={o}
            onSaved={() => {
              reload();
              ordersChanged();
            }}
          />

          <Card title="Suivi" icon="clock">
            <p className="text-sm text-stone-600">{t("Reçue le {date}", { date: formatTime(o.createdAt) })}</p>
            {o.prepMinutes && <p className="mt-2 text-sm text-stone-600">{t("Préparation annoncée : {n} min", { n: o.prepMinutes })}</p>}
            {o.status === "READY" && o.fulfillment === "DELIVERY" && (
              <p className="mt-2 text-sm text-stone-600">{o.driver ? t("Livreur en route : {name}, {phone}", { name: o.driver.name, phone: o.driver.phone }) : t("Zedeka assigne un livreur.")}</p>
            )}
            {o.status === "READY" && o.tableNumber != null && (
              <p className="mt-2 text-sm text-stone-600">{t("Apportez la commande à la table {number}, puis touchez « Servie ».", { number: o.tableNumber })}</p>
            )}
            {o.status === "READY" && o.fulfillment === "PICKUP" && o.tableNumber == null && (
              <p className="mt-2 text-sm text-stone-600">{t("Le client vient la chercher. Touchez « Remis au client » une fois la commande remise et payée.")}</p>
            )}
            {o.cancellationReason && <p className="mt-2 text-sm text-red-700">{t("Annulée :")} {o.cancellationReason}</p>}
          </Card>

          <Link href="/restaurant/commandes" className="block text-sm text-emerald-700">
            ← {t("Toutes les commandes")}
          </Link>
        </div>
      </div>
    </div>
  );
}
