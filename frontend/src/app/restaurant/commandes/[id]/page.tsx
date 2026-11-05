"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { STATUS_LABEL, type OrderStatus } from "@/components/panel/status";
import {
  button,
  buttonDanger,
  buttonGhost,
  Card,
  ErrorNote,
  input,
  Loading,
  PageHeader,
} from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { formatTime } from "@/lib/admin";
import { restaurantFetch, type RestaurantOrder } from "@/lib/restaurant";
import { ordersChanged } from "../../useNewOrders";
import { useRestaurant, useRestaurantAction } from "../../useRestaurant";
import OrderEditor from "./OrderEditor";
import DriverMessage from "./DriverMessage";
import { useRestaurantRole } from "../../RestaurantRole";
import { useT } from "@/lib/i18n/client";

const REASONS = [
  "Plat épuisé",
  "Trop de commandes en cours",
  "Fermeture imminente",
];

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={`flex justify-between gap-2 ${strong ? "text-base font-semibold" : ""}`}
    >
      <dt>{t(label)}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

const ROLE_LABEL = {
  OWNER: "gérant",
  MANAGER: "manageuse",
  CASHIER: "caissière",
} as const;
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const hm = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Pastille « En direct » de l'en-tête : étape et chrono (rouge si le temps annoncé est dépassé).
function LivePill({ o }: { o: RestaurantOrder }) {
  const t = useT();
  const now = useNow();
  const cooking = o.status === "CONFIRMED" || o.status === "PREPARING";
  const start = cooking
    ? (o.preparingAt ?? o.confirmedAt)
    : o.status === "READY"
      ? o.readyAt
      : o.status === "PENDING"
        ? o.createdAt
        : null;
  const elapsed = start ? now - new Date(start).getTime() : 0;
  const late = cooking && !!o.prepMinutes && elapsed > o.prepMinutes * 60_000;
  const label =
    o.status === "PREPARING" ? t("En cuisine") : t(STATUS_LABEL[o.status]);
  const tone = late
    ? "bg-red-50 text-red-700"
    : o.status === "CANCELLED"
      ? "bg-red-50 text-red-700"
      : start
        ? "bg-emerald-50 text-emerald-800"
        : "bg-stone-100 text-stone-700";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums ${tone}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${late || o.status === "CANCELLED" ? "bg-red-600" : start ? "bg-[#0e7c4a]" : "bg-stone-400"}`}
      />
      {label}
      {start &&
        ` · ${clock(elapsed)}${cooking && o.prepMinutes ? ` / ${o.prepMinutes}` : ""}`}
    </span>
  );
}

// Étapes : barre comme dans les applis mobiles, puis chronologie avec l'heure et qui a agi.
function Steps({ o }: { o: RestaurantOrder }) {
  const t = useT();
  const delivery = o.fulfillment === "DELIVERY" && o.tableNumber == null;
  const bar = [
    { label: "Acceptée", at: o.confirmedAt },
    { label: "En cuisine", at: o.preparingAt },
    { label: "Prête", at: o.readyAt },
    ...(delivery ? [{ label: "Récupérée", at: o.pickedUpAt }] : []),
    {
      label: delivery ? "Livrée" : o.tableNumber != null ? "Servie" : "Remise",
      at: o.deliveredAt,
    },
  ];
  const reached = bar.reduce((last, s, i) => (s.at ? i : last), -1);
  const who = o.confirmedBy
    ? ` ${t("par {name}", { name: o.confirmedBy })}${o.confirmedByRole && o.confirmedByRole !== "OWNER" ? ` (${t(ROLE_LABEL[o.confirmedByRole])})` : ""}`
    : "";
  const timeline = [
    { label: t("Reçue"), at: o.createdAt },
    {
      label: `${t("Acceptée")}${who}${o.prepMinutes ? ` · ${o.prepMinutes} min` : ""}`,
      at: o.confirmedAt,
    },
    { label: t("En cuisine"), at: o.preparingAt },
    { label: t("Prête"), at: o.readyAt },
    ...(delivery
      ? [
          { label: t("Récupérée par le livreur"), at: o.pickedUpAt },
          { label: t("Livrée au client"), at: o.deliveredAt },
        ]
      : [
          {
            label:
              o.tableNumber != null
                ? t("Servie à la table")
                : t("Remise au client"),
            at: o.deliveredAt,
          },
        ]),
  ];
  const last = timeline.reduce((l, s, i) => (s.at ? i : l), -1);
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-4 print:hidden">
      <h2 className="mb-3 font-bold">{t("Étapes")}</h2>
      {o.status !== "CANCELLED" && (
        <div
          className="mb-4 grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${bar.length}, minmax(0, 1fr))`,
          }}
        >
          {bar.map((s, i) => (
            <div key={s.label}>
              <span
                className={`block h-1.5 rounded-full ${i <= reached ? "bg-[#0e7c4a]" : i === reached + 1 ? "bg-emerald-200" : "bg-stone-200"}`}
              />
              <span
                className={`mt-1 block text-[11px] ${i === reached ? "font-bold text-stone-900" : "text-stone-500"}`}
              >
                {t(s.label)}
              </span>
            </div>
          ))}
        </div>
      )}
      <ol className="relative space-y-2.5">
        {timeline.map((s, i) => (
          <li key={i} className="relative flex items-center gap-3 text-sm">
            {i < timeline.length - 1 && (
              <span
                className={`absolute left-[5px] top-3.5 h-[calc(100%+2px)] w-0.5 ${i < last ? "bg-[#0e7c4a]" : "bg-stone-200"}`}
              />
            )}
            <span
              className={`relative z-10 h-3 w-3 shrink-0 rounded-full ${i < last || (s.at && i !== last) ? "bg-[#0e7c4a]" : i === last ? "border-[3px] border-[#0e7c4a] bg-white" : "bg-stone-200"}`}
            />
            <span
              className={`flex-1 ${s.at ? (i === last ? "font-bold" : "") : "text-stone-400"}`}
            >
              {s.label}
            </span>
            {s.at &&
              (i === last && o.status !== "DELIVERED" ? (
                <span className="rounded bg-emerald-50 px-1.5 text-xs font-semibold text-emerald-800">
                  {hm(s.at)}
                </span>
              ) : (
                <span className="text-xs text-stone-500">{hm(s.at)}</span>
              ))}
          </li>
        ))}
        {o.status === "CANCELLED" && (
          <li className="flex items-center gap-3 text-sm font-semibold text-red-700">
            <span className="h-3 w-3 rounded-full bg-red-600" />
            <span className="flex-1">{t("Annulée")}</span>
            {o.cancelledAt && (
              <span className="text-xs">{hm(o.cancelledAt)}</span>
            )}
          </li>
        )}
      </ol>
    </section>
  );
}

export default function RestaurantOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const {
    data: o,
    error,
    reload,
  } = useRestaurant<RestaurantOrder>(`/orders/${id}`);
  const action = useRestaurantAction();
  const [minutes, setMinutes] = useState("20");
  const [refusing, setRefusing] = useState(false);
  const role = useRestaurantRole();
  const t = useT();

  if (error) return <ErrorNote message={error} />;
  if (!o) return <Loading />;

  const move = (
    status: OrderStatus,
    extra: { prepMinutes?: number; reason?: string } = {},
  ) =>
    action.run(async () => {
      await restaurantFetch(`/orders/${id}/status`, {
        method: "POST",
        body: { status, ...extra },
      });
      await reload();
      ordersChanged();
    });
  // Tant que la commande n'est pas acceptée, le restaurant ne voit ni le livreur ni le numéro du client.
  const accepted =
    o.status !== "PENDING" && (o.status !== "CANCELLED" || !!o.confirmedAt);
  const prep = Number(minutes) > 0 ? { prepMinutes: Number(minutes) } : {};
  // Retrait ou sur place payé en espèces : la caisse encaisse au comptoir (une livraison se paie au livreur).
  const canCollect =
    o.fulfillment === "PICKUP" &&
    o.paymentStatus !== "PAID" &&
    !["PENDING", "CANCELLED"].includes(o.status);
  const collect = () =>
    action.run(async () => {
      await restaurantFetch(`/orders/${id}/paid`, { method: "POST" });
      await reload();
      ordersChanged();
    });

  // Action principale proposée en haut à droite, selon l'étape.
  const main =
    o.status === "PENDING" ? (
      <button
        onClick={() => move(prep.prepMinutes ? "PREPARING" : "CONFIRMED", prep)}
        className={button}
      >
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
        <Icon name="check" className="h-4 w-4" />{" "}
        {t("Servie à la table {number}", { number: o.tableNumber })}
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
            <LivePill o={o} />
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
          <span className="grid h-16 min-w-16 place-items-center rounded-xl bg-emerald-600 px-3 text-3xl font-extrabold text-white">
            {o.tableNumber}
          </span>
          <div>
            <p className="text-lg font-bold text-emerald-900">
              {t("Table {number}", { number: o.tableNumber })}
            </p>
            <p className="text-sm text-emerald-900">
              {t("Commande sur place : apportez-la à la table, sans livreur.")}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Steps o={o} />
          <Card title={t("Bon {code}", { code: o.code })} icon="receipt">
            <p className="mb-3 hidden text-sm print:block">
              {o.restaurant?.name} · {formatTime(o.createdAt)} ·{" "}
              {o.tableNumber != null
                ? t("Table {number}", { number: o.tableNumber })
                : o.fulfillment === "PICKUP"
                  ? t("À emporter")
                  : t("Livraison Zedeka")}
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
                      {i.variantName && (
                        <span className="block text-stone-600">
                          {i.variantName}
                        </span>
                      )}
                      {i.addons.map((a) => (
                        <span key={a.name} className="block text-stone-600">
                          + {a.name} ({fcfa(a.price)})
                        </span>
                      ))}
                    </td>
                    <td className="py-1.5 text-right text-base font-semibold">
                      {i.quantity}
                    </td>
                    <td className="py-1.5 text-right">{fcfa(i.unitPrice)}</td>
                    <td className="py-1.5 text-right">
                      {fcfa(i.unitPrice * i.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {o.note && (
              <p className="mt-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                {t("Note du client :")} {o.note}
              </p>
            )}
            <dl className="mt-4 space-y-1 border-t border-stone-100 pt-3 text-sm">
              <Row label="Sous-total des plats" value={fcfa(o.subtotal)} />
              {o.promoCode && o.discount > 0 && (
                <div className="flex justify-between gap-2 font-semibold text-emerald-700">
                  <dt>
                    {t("Promo {code}", { code: o.promoCode })} (
                    {o.promoPayer === "RESTAURANT"
                      ? t("payée par le restaurant")
                      : t("payée par Zedeka")}
                    )
                  </dt>
                  <dd className="text-right">− {fcfa(o.discount)}</dd>
                </div>
              )}
              {o.commission > 0 && (
                <Row
                  label="Commission Zedeka"
                  value={`− ${fcfa(o.commission)}`}
                />
              )}
              {o.fulfillment === "PICKUP" && o.paymentMethod === "CASH" ? (
                <Row
                  label="Pour le restaurant"
                  value={fcfa(o.subtotal - o.commission)}
                  strong
                />
              ) : (
                <Row
                  label="Dû au restaurant"
                  value={fcfa(
                    o.subtotal -
                      o.commission -
                      (o.promoPayer === "RESTAURANT" ? o.discount : 0),
                  )}
                  strong
                />
              )}
              <Row
                label="Paiement client"
                value={`${o.paymentMethod === "CASH" ? t("Espèces") : t("Mobile money")} · ${o.paymentStatus === "PAID" ? t("payé") : t("non payé")} · ${fcfa(o.total)}`}
              />
              {o.counterPaidBy && o.counterPaidAt && (
                <Row
                  label="Encaissé au comptoir"
                  value={`${o.counterPaidBy} · ${formatTime(o.counterPaidAt)}`}
                />
              )}
            </dl>
            {canCollect && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 p-3 print:hidden">
                <p className="text-sm text-amber-900">
                  {t("À encaisser au comptoir : {amount}", {
                    amount: fcfa(o.total),
                  })}
                </p>
                <button onClick={collect} className={button}>
                  <Icon name="wallet" className="h-4 w-4" /> {t("Encaisser")}
                </button>
              </div>
            )}
          </Card>

          <Card title="Client" icon="user">
            <div className="space-y-0.5 text-sm">
              <p>{o.customerName}</p>
              {!accepted && (
                <p className="text-stone-500">
                  {t(
                    "Le numéro du client s'affiche une fois la commande acceptée.",
                  )}
                </p>
              )}
              {o.customerPhone && (
                <a
                  href={`tel:${o.customerPhone.replace(/ /g, "")}`}
                  className="text-emerald-700"
                >
                  {o.customerPhone}
                </a>
              )}
              {o.fulfillment === "DELIVERY" && (
                <p className="text-stone-600">
                  {o.address} · {o.zone.name}
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-4 print:hidden">
          {["CONFIRMED", "PREPARING", "READY"].includes(o.status) && (
            // Gros boutons de la planche 4 : signaler « prête », prévenir le livreur, modifier ou imprimer.
            <div className="space-y-2">
              {o.status !== "READY" && (
                <button
                  onClick={() => move("READY")}
                  className="w-full rounded-lg bg-[#0e7c4a] px-4 py-3 text-sm font-bold text-white hover:bg-[#0b6a3f]"
                >
                  {t("Signaler « prête »")}
                </button>
              )}
              {o.driver && o.fulfillment === "DELIVERY" && (
                <button
                  onClick={() =>
                    action.run(async () => {
                      await restaurantFetch(`/orders/${id}/driver-message`, {
                        method: "POST",
                        body: {
                          kind: o.status === "READY" ? "READY" : "READY_SOON",
                        },
                      });
                      await reload();
                    })
                  }
                  className="w-full rounded-lg bg-[#ffb020] px-4 py-3 text-sm font-bold text-stone-900 hover:brightness-95"
                >
                  {t("Prévenir le livreur")}
                </button>
              )}
              <button
                onClick={() => window.print()}
                className="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm font-bold hover:bg-stone-50"
              >
                {t("Imprimer le bon")}
              </button>
            </div>
          )}
          {(o.status === "PENDING" || o.status === "CONFIRMED") && (
            <Card
              title={
                o.status === "PENDING" ? "Accepter ou refuser" : "Préparation"
              }
              icon="clock"
            >
              <label className="block text-sm">
                {t("Temps de préparation (minutes, facultatif)")}
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  className={`${input} mt-1`}
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-1">
                {[10, 20, 30, 45].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMinutes(String(m))}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${minutes === String(m) ? "border-emerald-600 bg-emerald-50" : "border-stone-300"}`}
                  >
                    {m} min
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">{main}</div>
              {o.status === "CONFIRMED" && (
                <button
                  onClick={() => move("READY")}
                  className={`${buttonGhost} mt-2`}
                >
                  {t("Déjà prête")}
                </button>
              )}
              {o.status === "PENDING" && (
                <>
                  <button
                    onClick={() => setRefusing((r) => !r)}
                    className="mt-3 block text-sm text-red-700"
                  >
                    {t("Refuser la commande")}
                  </button>
                  {refusing && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        move("CANCELLED", {
                          reason: String(
                            new FormData(e.currentTarget).get("reason") ?? "",
                          ),
                        });
                      }}
                      className="mt-2 space-y-2"
                    >
                      <input
                        name="reason"
                        list="refus"
                        required
                        minLength={3}
                        placeholder={t("Motif du refus")}
                        className={input}
                      />
                      <datalist id="refus">
                        {REASONS.map((r) => (
                          <option key={r} value={t(r)} />
                        ))}
                      </datalist>
                      <button className={buttonDanger}>
                        {t("Confirmer le refus")}
                      </button>
                    </form>
                  )}
                </>
              )}
            </Card>
          )}

          {o.fulfillment === "DELIVERY" &&
            o.tableNumber == null &&
            o.status !== "CANCELLED" && (
              // Étape par étape : le livreur n'apparaît qu'une fois la commande acceptée.
              <Card title="Livreur" icon="rider">
                {!accepted ? (
                  <p className="flex items-start gap-2 text-sm text-stone-500">
                    <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
                    {t(
                      "Acceptez la commande pour voir quel livreur viendra la chercher.",
                    )}
                  </p>
                ) : o.driver ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#ffb020] text-lg font-extrabold text-stone-900">
                        {o.driver.name.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-bold">{o.driver.name}</p>
                        <a
                          href={`tel:${o.driver.phone.replace(/ /g, "")}`}
                          className="text-xs text-emerald-700"
                        >
                          {o.driver.rating != null && (
                            <span className="text-stone-600">
                              ★ {o.driver.rating.toLocaleString("fr-FR")} ·{" "}
                            </span>
                          )}
                          {o.driver.phone}
                        </a>
                      </div>
                    </div>
                    {["CONFIRMED", "PREPARING", "READY"].includes(o.status) && (
                      <div className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2">
                        <span className="text-stone-600">
                          {o.driver.atRestaurant
                            ? t("Au restaurant")
                            : t("Arrive dans")}
                        </span>
                        <span className="font-bold">
                          {o.driver.atRestaurant
                            ? "✓"
                            : o.driver.etaMin != null
                              ? `${o.driver.etaMin} min`
                              : "—"}
                        </span>
                      </div>
                    )}
                    {o.driver.plate && (
                      <div className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2">
                        <span className="text-stone-600">{t("Plaque")}</span>
                        <span className="rounded bg-stone-900 px-1.5 py-0.5 font-mono text-xs font-bold text-white">
                          {o.driver.plate}
                        </span>
                      </div>
                    )}
                    <p className="text-stone-600">
                      {o.status === "PICKED_UP" || o.status === "DELIVERED"
                        ? t("A récupéré la commande.")
                        : o.status === "READY"
                          ? t("En route vers le restaurant.")
                          : t(
                              "Viendra chercher la commande quand elle sera prête.",
                            )}
                    </p>
                    {["CONFIRMED", "PREPARING", "READY"].includes(o.status) && (
                      <DriverMessage orderId={o.id} />
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-stone-600">
                    {t("Zedeka assigne un livreur.")}
                  </p>
                )}
              </Card>
            )}

          {role !== "CASHIER" && (
            <OrderEditor
              order={o}
              onSaved={() => {
                reload();
                ordersChanged();
              }}
            />
          )}

          <Card title="Suivi" icon="clock">
            <p className="text-sm text-stone-600">
              {t("Reçue le {date}", { date: formatTime(o.createdAt) })}
            </p>
            {o.prepMinutes && (
              <p className="mt-2 text-sm text-stone-600">
                {t("Préparation annoncée : {n} min", { n: o.prepMinutes })}
              </p>
            )}
            {o.status === "READY" && o.tableNumber != null && (
              <p className="mt-2 text-sm text-stone-600">
                {t(
                  "Apportez la commande à la table {number}, puis touchez « Servie ».",
                  { number: o.tableNumber },
                )}
              </p>
            )}
            {o.status === "READY" &&
              o.fulfillment === "PICKUP" &&
              o.tableNumber == null && (
                <p className="mt-2 text-sm text-stone-600">
                  {t(
                    "Le client vient la chercher. Touchez « Remis au client » une fois la commande remise et payée.",
                  )}
                </p>
              )}
            {o.cancellationReason && (
              <p className="mt-2 text-sm text-red-700">
                {t("Annulée :")} {o.cancellationReason}
              </p>
            )}
          </Card>

          <Link
            href="/restaurant/commandes"
            className="block text-sm text-emerald-700"
          >
            ← {t("Toutes les commandes")}
          </Link>
        </div>
      </div>
    </div>
  );
}
