"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import type { RestaurantOrder } from "@/lib/restaurant";
import type { T } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

// Mode caisse : les commandes à accepter et à traiter, chacune avec un seul gros bouton pour l'étape suivante.
// Trois affichages au choix du restaurant : tableau en colonnes, file unique, caisse (liste et ticket).

export type Layout = "tableau" | "file" | "caisse";
export type Move = (o: RestaurantOrder, status: "CONFIRMED" | "PREPARING" | "READY" | "DELIVERED" | "CANCELLED", extra?: { prepMinutes?: number; reason?: string }) => Promise<boolean>;
export type Lists = { pending: RestaurantOrder[]; cooking: RestaurantOrder[]; ready: RestaurantOrder[] };

export const PREP_CHOICES = [10, 20, 30, 45];
export const REASONS = ["Plat épuisé", "Trop de commandes en cours", "Fermeture imminente"];

const minutesSince = (iso: string, now: number) => Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));

// Minutes restantes avant l'heure annoncée (négatif : en retard) ; null sans temps annoncé.
export function minutesLeft(o: RestaurantOrder, now: number) {
  if (o.status !== "PREPARING" || !o.prepMinutes) return null;
  const start = new Date(o.preparingAt ?? o.confirmedAt ?? o.createdAt).getTime();
  return Math.ceil((start + o.prepMinutes * 60_000 - now) / 60_000);
}

export function ago(iso: string, now: number, t: T) {
  const m = minutesSince(iso, now);
  return m < 1 ? t("à l'instant") : m < 60 ? t("il y a {n} min", { n: m }) : t("il y a {h} h {m}", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") });
}

// La plus urgente d'abord : en retard, puis la fin de préparation la plus proche, puis les acceptées, puis les prêtes.
export function byUrgency(list: RestaurantOrder[], now: number) {
  const rank = (o: RestaurantOrder) => {
    const left = minutesLeft(o, now);
    if (o.status === "PREPARING") return left ?? 30;
    if (o.status === "CONFIRMED") return 1_000;
    return 2_000;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
}

export const itemCount = (o: RestaurantOrder) => o.items.reduce((n, i) => n + i.quantity, 0);

function ModeBadge({ o, big }: { o: RestaurantOrder; big?: boolean }) {
  const t = useT();
  const size = big ? "text-sm" : "text-xs";
  if (o.tableNumber != null)
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-600 px-3 py-1 font-bold text-white ${size}`}>
        {t("Table {number}", { number: o.tableNumber })}
      </span>
    );
  if (o.fulfillment === "PICKUP")
    return (
      <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-sky-100 px-3 py-1 font-semibold text-sky-800 ${size}`}>
        <Icon name="bag" className="h-3.5 w-3.5" />
        {t("À emporter")}
      </span>
    );
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-stone-200 px-3 py-1 font-semibold text-stone-700 ${size}`}>
      <Icon name="rider" className="h-3.5 w-3.5" />
      {t("Livraison")}
    </span>
  );
}

function Items({ o, large }: { o: RestaurantOrder; large?: boolean }) {
  return (
    <ul className={`space-y-1 ${large ? "text-xl" : "text-[15px]"}`}>
      {o.items.map((i, n) => (
        <li key={n} className="flex gap-2">
          <span className={`${large ? "w-9" : "w-7"} shrink-0 font-extrabold`}>{i.quantity}×</span>
          <span className="min-w-0">
            <span className="font-semibold">{i.name}</span>
            {(i.variantName || i.addons.length > 0) && (
              <span className={`block text-stone-500 ${large ? "text-base" : "text-[13px]"}`}>{[i.variantName, ...i.addons.map((a) => `+ ${a.name}`)].filter(Boolean).join(" · ")}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function payLabel(o: RestaurantOrder, t: T) {
  if (o.paymentStatus === "PAID") return t("Payée");
  if (o.tableNumber != null) return t("À payer sur place");
  if (o.fulfillment === "PICKUP") return t("À payer au retrait");
  return o.paymentMethod === "CASH" ? t("Espèces à la livraison") : t("Mobile money");
}

function Timer({ o, now }: { o: RestaurantOrder; now: number }) {
  const t = useT();
  const left = minutesLeft(o, now);
  if (left === null) return <span className="whitespace-nowrap text-xs text-stone-500">{ago(o.createdAt, now, t)}</span>;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-sm font-bold ${left < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-900"}`}>
      <Icon name="clock" className="h-3.5 w-3.5" />
      {left < 0 ? t("Retard {n} min", { n: -left }) : t("{n} min", { n: left })}
    </span>
  );
}

function DriverLine({ o }: { o: RestaurantOrder }) {
  const t = useT();
  if (o.fulfillment !== "DELIVERY" || o.tableNumber != null) return null;
  if (o.status === "PENDING")
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-stone-500">
        <Icon name="lock" className="h-3.5 w-3.5" />
        {t("Livreur et téléphone visibles après acceptation")}
      </p>
    );
  return (
    <p className="mt-2 flex items-center gap-2 text-[13px] font-medium text-stone-700">
      <Icon name="rider" className="h-4 w-4 text-emerald-700" />
      {o.driver ? (o.status === "READY" ? t("{name} vient la chercher", { name: o.driver.name }) : t("{name} viendra la chercher", { name: o.driver.name })) : t("Zedeka assigne un livreur.")}
    </p>
  );
}

// Temps de préparation proposés avant d'accepter.
export function PrepChips({ value, onChange, large }: { value: number; onChange: (m: number) => void; large?: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`mr-1 whitespace-nowrap text-stone-500 ${large ? "text-sm font-semibold" : "text-xs"}`}>{t("Prête dans")}</span>
      {PREP_CHOICES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          aria-pressed={value === m}
          className={`whitespace-nowrap border font-semibold ${large ? "rounded-xl border-2 px-4 py-2 text-base" : "rounded-full px-3 py-1 text-xs"} ${value === m ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300 text-stone-600"}`}
        >
          {t("{n} min", { n: m })}
        </button>
      ))}
    </div>
  );
}

// Accepter (avec le temps choisi) ou refuser (avec un motif touché en un geste).
export function AcceptRefuse({ o, move, large }: { o: RestaurantOrder; move: Move; large?: boolean }) {
  const t = useT();
  const [prep, setPrep] = useState(20);
  const [refusing, setRefusing] = useState(false);
  const [busy, setBusy] = useState(false);
  const go = async (...args: Parameters<Move> extends [RestaurantOrder, ...infer R] ? R : never) => {
    setBusy(true);
    await move(o, ...args);
    setBusy(false);
  };
  const h = large ? "h-16 text-xl" : "h-12 text-base";
  if (refusing)
    return (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-red-700">{t("Pourquoi refuser ?")}</p>
        <div className="grid gap-2">
          {REASONS.map((r) => (
            <button key={r} disabled={busy} onClick={() => go("CANCELLED", { reason: t(r) })} className="h-11 rounded-xl border-2 border-red-200 px-3 text-sm font-semibold text-red-700 disabled:opacity-60">
              {t(r)}
            </button>
          ))}
        </div>
        <button onClick={() => setRefusing(false)} className="w-full py-1 text-sm text-stone-600">
          {t("Annuler")}
        </button>
      </div>
    );
  return (
    <div>
      <PrepChips value={prep} onChange={setPrep} large={large} />
      <div className={`mt-2 grid gap-2 ${large ? "grid-cols-[1fr_auto] gap-3" : "grid-cols-[1fr_auto]"}`}>
        <button disabled={busy} onClick={() => go("PREPARING", { prepMinutes: prep })} className={`flex items-center justify-center gap-2 rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-60 ${h}`}>
          <Icon name="check" className={large ? "h-6 w-6" : "h-5 w-5"} />
          {large ? t("Accepter · {n} min", { n: prep }) : t("Accepter")}
        </button>
        <button disabled={busy} onClick={() => setRefusing(true)} className={`rounded-xl border-2 border-red-200 px-4 font-bold text-red-700 ${large ? "h-16 px-8 text-lg" : "h-12 text-sm"}`}>
          {t("Refuser")}
        </button>
      </div>
    </div>
  );
}

// Le bouton de l'étape suivante, ou ce qui se passe ensuite quand le restaurant n'a plus rien à faire.
export function NextStep({ o, move, large, compact }: { o: RestaurantOrder; move: Move; large?: boolean; compact?: boolean }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  if (o.status === "PENDING") return <AcceptRefuse o={o} move={move} large={large} />;
  const step: { label: string; short: string; icon: "fire" | "bag" | "check"; to: "PREPARING" | "READY" | "DELIVERED"; cls: string } | null =
    o.status === "CONFIRMED"
      ? { label: t("Lancer la préparation"), short: t("Lancer"), icon: "fire", to: "PREPARING", cls: "bg-emerald-600 text-white" }
      : o.status === "PREPARING"
        ? { label: t("Commande prête"), short: t("Prête"), icon: "bag", to: "READY", cls: "bg-sun text-ink" }
        : o.status === "READY" && o.tableNumber != null
          ? { label: t("Servie à la table {number}", { number: o.tableNumber }), short: t("Servie"), icon: "check", to: "DELIVERED", cls: "border-2 border-emerald-600 bg-white text-emerald-700" }
          : o.status === "READY" && o.fulfillment === "PICKUP"
            ? { label: t("Remis au client"), short: t("Remise"), icon: "check", to: "DELIVERED", cls: "border-2 border-emerald-600 bg-white text-emerald-700" }
            : null;
  if (!step)
    return compact ? (
      <span className="grid h-11 shrink-0 place-items-center rounded-xl bg-stone-100 px-3 text-stone-500" title={t("Le livreur la récupère")}>
        <Icon name="rider" />
      </span>
    ) : (
      <div className={`flex items-center justify-center gap-2 rounded-xl bg-stone-100 text-sm font-semibold text-stone-600 ${large ? "h-16" : "h-12"}`}>
        <Icon name="rider" />
        {t("Le livreur la récupère")}
      </div>
    );
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await move(o, step.to);
        setBusy(false);
      }}
      className={`flex items-center justify-center gap-2 rounded-xl font-bold disabled:opacity-60 ${step.cls} ${compact ? "h-11 shrink-0 px-4 text-sm" : large ? "h-16 w-full text-xl" : "h-12 w-full text-base"}`}
    >
      {!compact && <Icon name={step.icon} className={large ? "h-6 w-6" : "h-5 w-5"} />}
      {compact ? step.short : step.label}
    </button>
  );
}

// Fiche complète d'une commande (affichage tableau et onglet « À accepter »).
export function OrderCard({ o, now, move }: { o: RestaurantOrder; now: number; move: Move }) {
  const t = useT();
  const left = minutesLeft(o, now);
  const ring = o.status === "PENDING" ? "ring-2 ring-sun shadow-lg" : left !== null && left < 0 ? "ring-2 ring-red-400" : "border border-stone-200";
  return (
    <article className={`rounded-2xl bg-white p-4 ${ring}`} data-testid="pos-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Link href={`/restaurant/commandes/${o.id}`} className="flex min-w-0 items-center gap-2">
          <span className="text-lg font-extrabold tracking-tight">{o.code}</span>
          <ModeBadge o={o} />
        </Link>
        <Timer o={o} now={now} />
      </div>
      <Items o={o} />
      {o.note && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1 text-[13px] text-amber-900">« {o.note} »</p>}
      <div className="mt-2 flex flex-wrap justify-between gap-x-2 text-[13px] text-stone-600">
        <span>{o.customerName}</span>
        <span>
          <b className="text-ink">{fcfa(o.subtotal)}</b> · {payLabel(o, t)}
        </span>
      </div>
      <DriverLine o={o} />
      <div className="mt-3">
        <NextStep o={o} move={move} />
      </div>
    </article>
  );
}

// Ligne courte (onglet « À traiter ») : code, étape, plats en une ligne, et le bouton.
function OrderRow({ o, now, move }: { o: RestaurantOrder; now: number; move: Move }) {
  const t = useT();
  const left = minutesLeft(o, now);
  const step = { CONFIRMED: ["Acceptée", "bg-stone-200 text-stone-700"], PREPARING: ["En cuisine", "bg-amber-100 text-amber-900"], READY: ["Prête", "bg-emerald-100 text-emerald-800"] }[o.status as "READY"];
  const who = o.fulfillment === "DELIVERY" && o.tableNumber == null && o.driver ? o.driver.name : o.customerName;
  return (
    <article className={`rounded-2xl border bg-white p-3 ${left !== null && left < 0 ? "border-red-300" : "border-stone-200"}`} data-testid="pos-row">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/restaurant/commandes/${o.id}`} className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-extrabold">{o.code}</span>
            <ModeBadge o={o} />
            {step && <span className={`rounded-full px-2 py-1 text-xs font-semibold ${step[1]}`}>{t(step[0])}</span>}
          </div>
          <p className="mt-1 truncate text-[14px] text-stone-700">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(" · ")}</p>
          <p className="mt-1 text-xs text-stone-500">
            {left !== null && <b className={left < 0 ? "text-red-700" : "text-amber-800"}>{left < 0 ? t("Retard {n} min", { n: -left }) : t("Prête dans {n} min", { n: left })} · </b>}
            {who}
          </p>
        </Link>
        <NextStep o={o} move={move} compact />
      </div>
    </article>
  );
}

const TONES = {
  new: { bg: "bg-sun-soft", pill: "bg-sun text-ink" },
  cook: { bg: "bg-stone-200/60", pill: "bg-white text-ink" },
  ready: { bg: "bg-emerald-50", pill: "bg-emerald-600 text-white" },
};

function Segments<V extends string>({ tabs, value, onChange }: { tabs: { value: V; label: string; count: number; warn?: boolean }[]; value: V; onChange: (v: V) => void }) {
  const t = useT();
  return (
    <div role="tablist" className={`grid gap-1 rounded-xl bg-stone-200 p-1 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={tab.value === value}
          onClick={() => onChange(tab.value)}
          className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold ${tab.value === value ? "bg-white shadow-sm" : "text-stone-600"}`}
        >
          {t(tab.label)}
          <span className={`rounded-full px-2 text-xs font-bold ${tab.warn && tab.count ? "bg-sun text-ink" : "bg-stone-300/70"}`}>{tab.count}</span>
        </button>
      ))}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  const t = useT();
  return <p className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{t(text)}</p>;
}

// A — Tableau cuisine : trois colonnes sur grand écran, trois onglets sur téléphone.
export function BoardView({ lists, now, move }: { lists: Lists; now: number; move: Move }) {
  const [tab, setTab] = useState<"new" | "cook" | "ready">("new");
  const columns = [
    { key: "new" as const, title: "Nouvelles", icon: "bell" as const, list: lists.pending, empty: "Aucune nouvelle commande." },
    { key: "cook" as const, title: "En cuisine", icon: "fire" as const, list: byUrgency(lists.cooking, now), empty: "Rien en cuisine." },
    { key: "ready" as const, title: "Prêtes", icon: "bag" as const, list: lists.ready, empty: "Aucune commande prête." },
  ];
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3 md:hidden">
        <Segments
          tabs={columns.map((c) => ({ value: c.key, label: c.title, count: c.list.length, warn: c.key === "new" }))}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-3">
        {columns.map((c) => (
          <section key={c.key} className={`${tab === c.key ? "flex" : "hidden"} min-h-0 flex-col rounded-2xl p-3 md:flex ${TONES[c.key].bg}`} aria-label={t(c.title)}>
            <h2 className="mb-3 hidden items-center justify-between px-1 md:flex">
              <span className="flex items-center gap-2 text-base font-bold">
                <Icon name={c.icon} />
                {t(c.title)}
              </span>
              <span className={`rounded-full px-3 py-1 text-sm font-bold ${TONES[c.key].pill}`}>{c.list.length}</span>
            </h2>
            <div className="-m-1 min-h-0 flex-1 space-y-3 overflow-y-auto p-1">
              {c.list.length ? c.list.map((o) => <OrderCard key={o.id} o={o} now={now} move={move} />) : <Empty text={c.empty} />}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

// B — File unique : « À accepter » et « À traiter », la plus urgente en haut.
export function QueueView({ lists, now, move }: { lists: Lists; now: number; move: Move }) {
  const [tab, setTab] = useState<"accept" | "process">(lists.pending.length ? "accept" : "process");
  const todo = byUrgency([...lists.cooking, ...lists.ready], now);
  const t = useT();
  return (
    <div className="mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col">
      <div className="px-3 pt-3">
        <Segments
          tabs={[
            { value: "accept", label: "À accepter", count: lists.pending.length, warn: true },
            { value: "process", label: "À traiter", count: todo.length },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "accept" ? (
          <div className="grid gap-3 lg:grid-cols-2">{lists.pending.length ? lists.pending.map((o) => <OrderCard key={o.id} o={o} now={now} move={move} />) : <Empty text="Aucune nouvelle commande." />}</div>
        ) : (
          <div className="space-y-3">
            {todo.length > 0 && <p className="px-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{t("La plus urgente en haut")}</p>}
            {todo.length ? todo.map((o) => <OrderRow key={o.id} o={o} now={now} move={move} />) : <Empty text="Rien à traiter pour le moment." />}
          </div>
        )}
      </div>
    </div>
  );
}

// C — Caisse : la liste à gauche, le ticket en grand à droite (sur téléphone, l'un après l'autre).
export function SplitView({ lists, now, move }: { lists: Lists; now: number; move: Move }) {
  const t = useT();
  const all = [...lists.pending, ...byUrgency(lists.cooking, now), ...lists.ready];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phoneDetail, setPhoneDetail] = useState(false);
  const selected = all.find((o) => o.id === selectedId) ?? all[0];
  const groups = [
    { title: "Nouvelles", list: lists.pending },
    { title: "En cuisine", list: byUrgency(lists.cooking, now) },
    { title: "Prêtes", list: lists.ready },
  ];
  const dot = (o: RestaurantOrder) => {
    const left = minutesLeft(o, now);
    return { PENDING: "bg-sun", CONFIRMED: "bg-stone-400", PREPARING: left !== null && left < 0 ? "bg-red-500" : "bg-amber-500", READY: "bg-emerald-500" }[o.status as "READY"] ?? "bg-stone-400";
  };
  return (
    <div className="grid min-h-0 flex-1 md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr]">
      <aside className={`${phoneDetail ? "hidden" : "block"} min-h-0 overflow-y-auto border-stone-200 bg-stone-100 p-3 md:block md:border-r`}>
        {all.length === 0 && <Empty text="Aucune commande en cours." />}
        {groups.map(
          (g) =>
            g.list.length > 0 && (
              <div key={g.title}>
                <p className="px-2 pb-1 pt-3 text-xs font-bold uppercase tracking-wide text-stone-500">
                  {t(g.title)} · {g.list.length}
                </p>
                <div className="space-y-2">
                  {g.list.map((o) => {
                    const sel = o.id === selected?.id;
                    const left = minutesLeft(o, now);
                    return (
                      <button
                        key={o.id}
                        onClick={() => (setSelectedId(o.id), setPhoneDetail(true))}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${sel ? "bg-emerald-600 text-white" : "bg-white"}`}
                      >
                        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot(o)} ${sel ? "ring-2 ring-white" : ""}`} />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-extrabold">{o.code}</span>
                            <span className={`text-xs ${sel ? "text-emerald-50" : left !== null && left < 0 ? "font-bold text-red-700" : "text-stone-500"}`}>
                              {left !== null ? (left < 0 ? t("Retard {n} min", { n: -left }) : t("{n} min", { n: left })) : ago(o.createdAt, now, t)}
                            </span>
                          </span>
                          <span className={`block truncate text-xs ${sel ? "text-emerald-50" : "text-stone-600"}`}>
                            {o.tableNumber != null ? t("Table {number}", { number: o.tableNumber }) : o.fulfillment === "PICKUP" ? t("À emporter") : t("Livraison")} ·{" "}
                            {t("{n} article(s)", { n: itemCount(o) })} · {fcfa(o.subtotal)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ),
        )}
      </aside>
      <section className={`${phoneDetail ? "flex" : "hidden"} min-h-0 flex-col overflow-y-auto p-4 md:flex lg:p-6`}>
        {selected ? (
          <>
            <button onClick={() => setPhoneDetail(false)} className="mb-3 flex items-center gap-1 text-sm font-semibold text-emerald-700 md:hidden">
              <Icon name="back" className="h-4 w-4" />
              {t("Toutes les commandes")}
            </button>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-extrabold tracking-tight lg:text-3xl">{t("Commande {code}", { code: selected.code })}</h1>
                  <ModeBadge o={selected} big />
                  <Timer o={selected} now={now} />
                </div>
                <p className="mt-1 text-stone-600">
                  {t("Reçue {when}", { when: ago(selected.createdAt, now, t) })} · {selected.customerName} · {payLabel(selected, t)}
                </p>
              </div>
              <Link href={`/restaurant/commandes/${selected.id}`} className="flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm font-semibold">
                <Icon name="receipt" className="h-4 w-4" />
                {t("Détail et bon")}
              </Link>
            </div>
            <div className="mt-4 flex-1 rounded-2xl border border-stone-200 bg-white p-5">
              <Items o={selected} large />
              {selected.note && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-amber-900">« {selected.note} »</p>}
              <div className="mt-4 flex justify-between border-t border-stone-100 pt-3 text-lg">
                <span className="text-stone-600">{t("Total des plats")}</span>
                <b>{fcfa(selected.subtotal)}</b>
              </div>
              <DriverLine o={selected} />
            </div>
            <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-4">
              <NextStep key={selected.id} o={selected} move={move} large />
            </div>
          </>
        ) : (
          <Empty text="Aucune commande en cours." />
        )}
      </section>
    </div>
  );
}

// Nouvelle commande en plein écran : elle sonne jusqu'à ce que le restaurant accepte, refuse ou la mette de côté.
export function NewOrderAlert({ o, others, now, move, soundBlocked, onLater }: { o: RestaurantOrder; others: number; now: number; move: Move; soundBlocked: boolean; onLater: () => void }) {
  const t = useT();
  return (
    <div role="alertdialog" aria-label={t("Nouvelle commande")} className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-ink/70 p-3">
      <div className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center gap-4 bg-sun px-5 py-4 text-ink">
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white">
            <span className="anim-wave absolute inset-0 rounded-full border-4 border-white" aria-hidden="true" />
            <Icon name="bell" className="anim-shake h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-2xl font-extrabold">{t("Nouvelle commande")}</p>
            <p className="font-semibold">
              {o.code} · {ago(o.createdAt, now, t)}
            </p>
          </div>
        </div>
        <div className="p-5">
          {soundBlocked && <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("Touchez l'écran une fois pour activer la sonnerie.")}</p>}
          <div className="mb-3 flex items-center gap-3">
            {o.tableNumber != null ? (
              <span className="grid h-14 min-w-14 place-items-center rounded-xl bg-emerald-600 px-3 text-3xl font-extrabold text-white">{o.tableNumber}</span>
            ) : null}
            <div>
              <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
                {o.tableNumber != null ? t("Table {number}", { number: o.tableNumber }) : <ModeBadge o={o} big />}
                {o.customerName !== t("Table {number}", { number: o.tableNumber ?? "" }) && <span>{o.customerName}</span>}
              </p>
              <p className="text-sm text-stone-600">
                {fcfa(o.subtotal)} · {payLabel(o, t)}
              </p>
            </div>
          </div>
          <Items o={o} large />
          {o.note && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-amber-900">« {o.note} »</p>}
          <div className="mt-5">
            <AcceptRefuse o={o} move={move} large />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-stone-500">
            <span>{others > 0 ? t("{n} autre(s) commande(s) attendent aussi.", { n: others }) : ""}</span>
            <button onClick={onLater} className="font-semibold text-stone-600 underline">
              {t("Voir le tableau")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
