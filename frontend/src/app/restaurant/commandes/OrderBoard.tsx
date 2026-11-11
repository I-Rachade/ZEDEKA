"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { beep } from "@/components/panel/beep";
import { ErrorNote, Loading } from "@/components/panel/ui";
import type { OrderStatus } from "@/components/panel/status";
import { fcfa, lineLabel } from "@/lib/api";
import { DEFAULT_PREP_MINUTES, restaurantFetch, type RestaurantOrder } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { ordersChanged } from "../useNewOrders";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

// Tableau « En direct » de la planche 4 : compteurs en haut, trois colonnes (nouvelles, en cuisine, prêtes) et un
// chrono par commande, rouge quand le temps de préparation annoncé est dépassé.

const ACCEPT_MINUTES = DEFAULT_PREP_MINUTES;

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const since = (iso: string | null | undefined, now: number) =>
  iso ? now - new Date(iso).getTime() : 0;

function Pill({
  tone,
  children,
}: {
  tone: "sun" | "green" | "red" | "grey";
  children: React.ReactNode;
}) {
  const tones = {
    sun: "bg-amber-50 text-amber-800",
    green: "bg-emerald-50 text-emerald-800",
    red: "bg-red-50 text-red-700",
    grey: "bg-stone-100 text-stone-600",
  };
  const dots = {
    sun: "bg-[#ffb020]",
    green: "bg-[#0e7c4a]",
    red: "bg-red-600",
    grey: "bg-stone-400",
  };
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${tones[tone]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />
      {children}
    </span>
  );
}

// Cuisine : chrono depuis l'acceptation, comparé au temps annoncé.
function kitchen(o: RestaurantOrder, now: number) {
  const elapsed = since(o.preparingAt ?? o.confirmedAt, now);
  const late = !!o.prepMinutes && elapsed > o.prepMinutes * 60_000;
  return {
    elapsed,
    late,
    ratio: o.prepMinutes ? Math.min(1, elapsed / (o.prepMinutes * 60_000)) : 0,
  };
}

function Mode({ o }: { o: RestaurantOrder }) {
  const t = useT();
  if (o.tableNumber != null)
    return <>{t("Table {number} · sur place", { number: o.tableNumber })}</>;
  if (o.fulfillment === "PICKUP") return <>{t("À emporter")}</>;
  return <>{[t("Livraison"), o.zone?.name].filter(Boolean).join(" · ")}</>;
}

function DriverLine({ o, now }: { o: RestaurantOrder; now: number }) {
  const t = useT();
  if (o.tableNumber != null || o.fulfillment === "PICKUP") return null;
  const d = o.driver;
  if (!d)
    return (
      <p className="mt-1 text-xs text-stone-500">
        {t("Livreur pas encore affecté")}
      </p>
    );
  const first = d.name.split(" ")[0];
  return (
    <p className="mt-1 flex items-start gap-1 text-xs text-stone-700">
      <span aria-hidden>🛵</span>
      {d.atRestaurant
        ? o.status === "READY"
          ? t("{name} attend au comptoir depuis {n} min", {
              name: first,
              n: Math.max(1, Math.round(since(o.readyAt, now) / 60_000)),
            })
          : t("{name} est au restaurant", { name: first })
        : d.etaMin != null
          ? t("{name} arrive dans {n} min", { name: first, n: d.etaMin })
          : t("{name} viendra la chercher", { name: first })}
    </p>
  );
}

function Items({ o }: { o: RestaurantOrder }) {
  return (
    <p className="mt-1 line-clamp-2 text-xs text-stone-600">
      {o.items.map((i) => `${i.quantity}× ${lineLabel(i)}`).join(", ")}
    </p>
  );
}

function OrderCard({
  o,
  now,
  onMove,
}: {
  o: RestaurantOrder;
  now: number;
  onMove: (o: RestaurantOrder, s: OrderStatus, extra?: object) => void;
}) {
  const t = useT();
  const k = kitchen(o, now);
  const cooking = o.status === "CONFIRMED" || o.status === "PREPARING";
  return (
    <div
      className={`rounded-lg border bg-surface p-3 ${cooking && k.late ? "border-red-400 ring-1 ring-red-200" : "border-stone-200"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/restaurant/commandes/${o.id}`}
          className="font-bold hover:underline"
        >
          {o.code}
        </Link>
        {o.status === "PENDING" ? (
          <Pill tone="sun">{clock(since(o.createdAt, now))}</Pill>
        ) : cooking ? (
          o.prepMinutes ? (
            <Pill tone={k.late ? "red" : "green"}>
              {k.late ? `${t("Retard")} · ` : ""}
              {clock(k.elapsed)} / {o.prepMinutes}
            </Pill>
          ) : (
            <Pill tone="green">{clock(k.elapsed)}</Pill>
          )
        ) : (
          <Pill tone="grey">
            {t("Prête")} · {clock(since(o.readyAt, now))}
          </Pill>
        )}
      </div>
      {cooking && o.prepMinutes ? (
        <div className="mt-2 flex gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200"
            >
              <span
                className={`block h-full ${k.late ? "bg-red-500" : "bg-[#0e7c4a]"}`}
                style={{
                  width: `${Math.max(0, Math.min(1, k.ratio * 3 - i)) * 100}%`,
                }}
              />
            </span>
          ))}
        </div>
      ) : null}
      <Items o={o} />
      {o.status === "PENDING" && (
        <p className="mt-1 text-xs text-stone-500">
          <Mode o={o} />
        </p>
      )}
      {o.status !== "PENDING" && <DriverLine o={o} now={now} />}
      {o.status !== "PENDING" && o.tableNumber != null && (
        <p className="mt-1 text-xs text-stone-500">
          <Mode o={o} />
        </p>
      )}
      {o.status !== "PENDING" &&
        o.fulfillment === "PICKUP" &&
        o.tableNumber == null && (
          <p className="mt-1 text-xs text-stone-500">
            <Mode o={o} />
          </p>
        )}
      {o.promoCode && (
        <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">
          {t("Promo {code}", { code: o.promoCode })}
        </span>
      )}
      {o.status === "PENDING" && (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() =>
              onMove(o, "PREPARING", { prepMinutes: ACCEPT_MINUTES })
            }
            className="flex-1 rounded-md bg-[#0e7c4a] px-2 py-2 text-xs font-bold text-white hover:bg-[#0b6a3f]"
          >
            {t("Accepter · {n} min", { n: ACCEPT_MINUTES })}
          </button>
          <Link
            href={`/restaurant/commandes/${o.id}`}
            className="rounded-md border border-red-300 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            {t("Refuser")}
          </Link>
        </div>
      )}
      {cooking && (
        // Temps annoncé écoulé : le bouton passe au premier plan pour qu'on n'oublie pas de signaler « prête ».
        <button
          onClick={() => onMove(o, "READY")}
          className={
            k.late
              ? "mt-2 w-full rounded-md bg-[#0e7c4a] px-2 py-2 text-xs font-bold text-white"
              : "mt-2 w-full rounded-md border border-stone-300 px-2 py-2 text-xs font-semibold hover:bg-stone-50"
          }
        >
          {k.late ? t("C'est prêt ? Touchez ici") : t("Signaler « prête »")}
        </button>
      )}
      {o.status === "READY" &&
        o.fulfillment === "DELIVERY" &&
        o.tableNumber == null &&
        o.driver && (
          // « Prête » a déjà prévenu le livreur : ce bouton ne sert plus qu'à le relancer.
          <button
            onClick={() => onMove(o, "READY", { notify: true })}
            className="mt-2 w-full py-1 text-xs font-semibold text-stone-600 underline-offset-2 hover:underline"
          >
            {t("Livreur prévenu · relancer")}
          </button>
        )}
      {o.status === "READY" &&
        (o.fulfillment === "PICKUP" || o.tableNumber != null) && (
          <button
            onClick={() => onMove(o, "DELIVERED")}
            className="mt-2 w-full rounded-md bg-[#0e7c4a] px-2 py-2 text-xs font-bold text-white"
          >
            {o.tableNumber != null
              ? t("Servie à la table {number}", { number: o.tableNumber })
              : t("Remis au client")}
          </button>
        )}
    </div>
  );
}

function Column({
  title,
  orders,
  children,
}: {
  title: string;
  orders: RestaurantOrder[];
  children: (o: RestaurantOrder) => React.ReactNode;
}) {
  const t = useT();
  return (
    <section className="min-w-0 rounded-lg bg-stone-100 p-3">
      <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-bold">
        {t(title)} <span className="text-stone-500">{orders.length}</span>
      </h2>
      <div className="space-y-2">
        {orders.length ? (
          orders.map(children)
        ) : (
          <p className="px-1 py-4 text-center text-xs text-stone-500">
            {t("Rien pour l'instant")}
          </p>
        )}
      </div>
    </section>
  );
}

function Counter({
  value,
  label,
  alert,
}: {
  value: string | number;
  label: string;
  alert?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={`rounded-lg border bg-surface px-4 py-3 ${alert ? "border-red-300" : "border-stone-200"}`}
    >
      <p
        className={`text-2xl font-extrabold tabular-nums ${alert ? "text-red-600" : ""}`}
      >
        {value}
      </p>
      <p className="text-xs text-stone-500">{t(label)}</p>
    </div>
  );
}

export default function OrderBoard({ reloadKey }: { reloadKey: number }) {
  const now = useNow();
  const orders = useRestaurant<RestaurantOrder[]>("/orders?active=1");
  const dash = useRestaurant<{ today: { sales: number } }>("/dashboard");
  const action = useRestaurantAction();
  const { reload } = orders;
  const { reload: reloadDash } = dash;

  useEffect(() => {
    if (reloadKey) {
      reload();
      reloadDash();
    }
  }, [reloadKey, reload, reloadDash]);
  // Rafraîchit le livreur (distance) et les nouvelles commandes toutes les 20 secondes.
  useEffect(() => {
    const id = setInterval(reload, 20_000);
    return () => clearInterval(id);
  }, [reload]);

  // Un bip quand une commande dépasse le temps annoncé : rappel de signaler « prête » (pas au chargement de la page).
  const lateIds = (orders.data ?? [])
    .filter((o) => (o.status === "CONFIRMED" || o.status === "PREPARING") && kitchen(o, now).late)
    .map((o) => o.id)
    .join(",");
  const beeped = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders.data) return;
    const ids = lateIds ? lateIds.split(",") : [];
    if (beeped.current === null) {
      beeped.current = new Set(ids);
      return;
    }
    const known = beeped.current;
    const fresh = ids.filter((id) => !known.has(id));
    fresh.forEach((id) => known.add(id));
    if (fresh.length) beep();
  }, [lateIds, orders.data]);

  // Interface mise à jour avant la réponse du serveur : la commande change de colonne dès le geste (« Accepter »,
  // « Prête »). Si le serveur refuse, elle revient à sa place et le message d'erreur s'affiche.
  const [moved, setMoved] = useState<Record<string, Partial<RestaurantOrder>>>({});
  const move = async (
    o: RestaurantOrder,
    status: OrderStatus,
    extra: { prepMinutes?: number; notify?: boolean } = {},
  ) => {
    if (!extra.notify) {
      const at = new Date().toISOString();
      const stamp: Partial<RestaurantOrder> =
        status === "CONFIRMED" ? { confirmedAt: at } : status === "PREPARING" ? { preparingAt: at, confirmedAt: o.confirmedAt ?? at } : status === "READY" ? { readyAt: at } : {};
      setMoved((m) => ({ ...m, [o.id]: { status, ...stamp, ...(extra.prepMinutes ? { prepMinutes: extra.prepMinutes } : {}) } }));
    }
    await action.run(async () => {
      if (extra.notify)
        await restaurantFetch(`/orders/${o.id}/driver-message`, {
          method: "POST",
          body: { kind: "READY" },
        });
      else
        await restaurantFetch(`/orders/${o.id}/status`, {
          method: "POST",
          body: { status, ...extra },
        });
      await reload();
      reloadDash();
      ordersChanged();
    });
    // Réponse reçue (ou refus) : la liste du serveur fait foi.
    setMoved((m) => {
      const rest = { ...m };
      delete rest[o.id];
      return rest;
    });
  };

  if (!orders.data)
    return orders.error ? <ErrorNote message={orders.error} /> : <Loading />;
  const list = orders.data
    .map((o) => (moved[o.id] ? { ...o, ...moved[o.id] } : o))
    .filter((o) => o.status !== "CANCELLED");
  const fresh = list
    .filter((o) => o.status === "PENDING")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const cooking = list.filter(
    (o) => o.status === "CONFIRMED" || o.status === "PREPARING",
  );
  const late = cooking.filter((o) => kitchen(o, now).late);
  // Les retards d'abord, puis les plus proches de la fin.
  cooking.sort(
    (a, b) =>
      Number(kitchen(b, now).late) - Number(kitchen(a, now).late) ||
      kitchen(b, now).ratio - kitchen(a, now).ratio,
  );
  const ready = list
    .filter((o) => o.status === "READY")
    .sort((a, b) => (a.readyAt ?? "").localeCompare(b.readyAt ?? ""));

  return (
    <div>
      <ErrorNote message={action.error} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Counter value={fresh.length} label="nouvelles" />
        <Counter value={cooking.length} label="en cuisine" />
        <Counter
          value={late.length}
          label="en retard"
          alert={late.length > 0}
        />
        <Counter
          value={
            dash.data ? fcfa(dash.data.today.sales).replace("FCFA", "F") : "…"
          }
          label="ventes du jour"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Column title="Nouvelles" orders={fresh}>
          {(o) => <OrderCard key={o.id} o={o} now={now} onMove={move} />}
        </Column>
        <Column title="En cuisine" orders={cooking}>
          {(o) => <OrderCard key={o.id} o={o} now={now} onMove={move} />}
        </Column>
        <Column title="Prêtes" orders={ready}>
          {(o) => <OrderCard key={o.id} o={o} now={now} onMove={move} />}
        </Column>
      </div>
    </div>
  );
}
