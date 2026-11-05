"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, fcfa, type Restaurant } from "@/lib/api";
import { getCart, reorderLines, saveCart } from "@/lib/cart";
import { customerFetch, useSession, type HistoryEntry } from "@/lib/customer";
import { trackHref } from "@/lib/device";
import { useI18n, useT } from "@/lib/i18n/client";
import { useHistory } from "../data";
import { card, dateTime, Empty, Logo, Skeleton } from "../ui";

function Entry({ h }: { h: HistoryEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { t, locale } = useI18n();
  const canReorder = h.kind === "FOOD" && !h.ongoing && h.restaurantSlug && h.items?.length;

  // Remet les plats d'une ancienne commande dans le panier ; les prix seront ceux d'aujourd'hui.
  async function reorder() {
    if (!h.restaurantSlug || !h.items) return;
    setBusy(true);
    try {
      const restaurant = await apiGet<Restaurant>(`/api/restaurants/${h.restaurantSlug}`);
      if (!restaurant) throw new Error(t("Ce restaurant n'est plus sur Zedeka."));
      const { lines, missing } = reorderLines(h.items, restaurant.menuItems);
      if (!lines.length) throw new Error(t("Ces plats ne sont plus proposés."));
      const current = getCart();
      if (current && current.slug !== restaurant.slug && !window.confirm(t("Remplacer le panier de {name} ?", { name: current.name }))) return;
      saveCart(restaurant.slug, restaurant.name, lines);
      if (missing.length) window.alert(t("Plus disponible : {items}. Le reste est dans votre panier.", { items: missing.join(", ") }));
      router.push(`/r/${restaurant.slug}`);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tile = h.logoUrl ? (
    <Logo url={h.logoUrl} name={h.title} size="h-12 w-12" />
  ) : (
    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[22px] ${h.kind === "PARCEL" ? "bg-sun/25" : "bg-emerald-600/10"}`} aria-hidden="true">
      {h.kind === "PARCEL" ? "📦" : "🍗"}
    </span>
  );

  // En cours : carte avec la barre nommée, comme le suivi.
  if (h.ongoing) {
    const bar = barFor(h);
    return (
      <li className={`${card} p-4`}>
        <Link href={trackHref(h.code)} className="block">
          <span className="flex gap-3">
            {tile}
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2">
                <span className="truncate text-[17px] font-semibold">{t(h.title)}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                  {t(bar.now)}
                </span>
              </span>
              <span className="block truncate text-[13px] text-stone-500">
                {h.code} · {h.items?.length ? `${t("{n} article(s)", { n: h.items.reduce((n, i) => n + i.quantity, 0) })} · ` : ""}
                {fcfa(h.total)}
              </span>
            </span>
          </span>
          <span className="mt-3 flex gap-1" aria-hidden="true">
            {bar.labels.map((l, i) => (
              <span key={l} className={`h-1.5 flex-1 rounded-full ${i < bar.reached ? "bg-emerald-600" : i === bar.reached ? "step-now" : "bg-stone-200"}`} />
            ))}
          </span>
          <span className="mt-1 flex gap-1 text-[11px]">
            {bar.labels.map((l, i) => (
              <span key={l} className={`flex-1 truncate text-center ${i === bar.reached ? "font-semibold text-stone-900" : "text-stone-400"}`}>
                {t(l)}
              </span>
            ))}
          </span>
        </Link>
      </li>
    );
  }

  // Passée : ligne compacte avec « Refaire ».
  return (
    <li className="flex items-center gap-3 py-3">
      <Link href={trackHref(h.code)} className="flex min-w-0 flex-1 items-center gap-3">
        {tile}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{t(h.title)}</span>
          <span className="block truncate text-[13px] text-stone-500">
            {h.status === "CANCELLED" ? t("Annulée") : h.kind === "PARCEL" ? t("Livré") : t("Livrée")} · {dateTime(h.createdAt, locale)} · {fcfa(h.total)}
          </span>
        </span>
      </Link>
      {canReorder ? (
        <button onClick={reorder} disabled={busy} className="shrink-0 rounded-full bg-stone-100 px-3 py-1.5 text-[13px] font-semibold text-stone-700 disabled:opacity-60">
          {busy ? t("Un instant…") : t("Refaire")}
        </button>
      ) : (
        h.kind === "PARCEL" && (
          <Link href="/colis" className="shrink-0 rounded-full bg-stone-100 px-3 py-1.5 text-[13px] font-semibold text-stone-700">
            {t("Refaire")}
          </Link>
        )
      )}
    </li>
  );
}

// Barre nommée d'une commande en cours (repas ou colis), comme en haut du suivi.
const FOOD_BAR = { labels: ["Confirmée", "En cuisine", "Prête", "En route", "Livrée"], at: ["CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED"] };
const PARCEL_BAR = { labels: ["Reçu", "Livreur", "En route", "Livré"], at: ["PENDING", "CONFIRMED", "PICKED_UP", "DELIVERED"] };
const RANK = ["PENDING", "CONFIRMED", "PREPARING", "READY", "PICKED_UP", "DELIVERED"];
function barFor(h: HistoryEntry) {
  const b = h.kind === "PARCEL" ? PARCEL_BAR : FOOD_BAR;
  const reached = Math.max(0, b.at.findLastIndex((s) => RANK.indexOf(s) <= RANK.indexOf(h.status)));
  const now = h.kind === "PARCEL" && h.status === "PENDING" ? "Livreur cherché" : h.status === "PENDING" ? "Reçue" : b.labels[reached];
  return { labels: b.labels, reached, now };
}

type Ride = {
  id: string;
  code: string;
  status: "SEARCHING" | "ACCEPTED" | "ONBOARD" | "COMPLETED" | "NO_DRIVER" | "CANCELLED";
  landmark: string | null;
  destination: string | null;
  createdAt: string;
  onboardAt: string | null;
  completedAt: string | null;
  cancelledBy: string | null;
  price: number | null;
  rating: number | null;
  ongoing: boolean;
  driver: { name: string; plate: string | null } | null;
};

const RIDE_STATUS: Record<Ride["status"], string> = {
  SEARCHING: "Recherche d'un Zed",
  ACCEPTED: "Votre Zed arrive",
  ONBOARD: "En route",
  COMPLETED: "Terminée",
  NO_DRIVER: "Aucun Zed disponible",
  CANCELLED: "Annulée",
};

function RideEntry({ r, featured = false }: { r: Ride; featured?: boolean }) {
  const { t, locale } = useI18n();
  const minutes = r.onboardAt && r.completedAt ? Math.max(1, Math.round((new Date(r.completedAt).getTime() - new Date(r.onboardAt).getTime()) / 60_000)) : null;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });
  const status = r.status === "CANCELLED" && r.cancelledBy === "CUSTOMER" ? t("Annulée par vous") : t(RIDE_STATUS[r.status]);
  // Carte détaillée (comme la planche) : conducteur, départ et arrivée, durée, prix convenu et note.
  const body = (
    <>
      <span className="flex items-center gap-3">
        <span className="deep-sun grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sun text-[18px] font-bold text-ink" aria-hidden="true">
          {r.driver ? r.driver.name[0]?.toUpperCase() : "🛵"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold">
            {t("Course {code}", { code: r.code })} · <span className={r.ongoing ? "text-emerald-700" : r.status === "COMPLETED" ? "" : "text-red-700"}>{status.toLowerCase()}</span>
          </span>
          <span className="block text-[13px] text-stone-500">
            {dateTime(r.createdAt, locale)}
            {r.onboardAt && r.completedAt && ` → ${hm(r.completedAt)}`}
            {minutes !== null && ` · ${t("{n} min", { n: minutes })}`}
          </span>
        </span>
      </span>
      <span className="mt-3 block space-y-2 text-sm">
        <span className="flex gap-3">
          <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" aria-hidden="true" />
          <span>
            <span className="block text-[12px] text-stone-500">{t("Départ")}</span>
            <span className="block font-semibold">{r.landmark ?? t("Ma position")}</span>
          </span>
        </span>
        {r.destination && (
          <span className="flex gap-3">
            <span className="w-3.5 shrink-0 text-[13px] leading-5" aria-hidden="true">
              🏁
            </span>
            <span>
              <span className="block text-[12px] text-stone-500">{t("Arrivée")}</span>
              <span className="block font-semibold">{r.destination}</span>
            </span>
          </span>
        )}
      </span>
      {r.driver && (
        <span className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-stone-50 px-3 py-2 text-sm">
          <span className="truncate">{r.driver.name}</span>
          {r.driver.plate && <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-[12px] font-bold text-white">{r.driver.plate}</span>}
        </span>
      )}
      {r.price !== null && (
        <span className="mt-3 flex justify-between text-sm">
          <span>{t("Prix convenu")}</span>
          <span className="font-bold tabular-nums">{fcfa(r.price)}</span>
        </span>
      )}
      {r.status === "COMPLETED" && (
        <span className="mt-1.5 flex items-center gap-2 text-sm">
          {t("Votre note :")}
          {r.rating !== null ? (
            <span className="text-[17px] text-sun" aria-label={t("{n} sur 5", { n: r.rating })}>
              {"★".repeat(r.rating)}
              <span className="text-stone-300">{"★".repeat(5 - r.rating)}</span>
            </span>
          ) : (
            <span className="font-semibold text-emerald-700">{t("Noter la course")}</span>
          )}
        </span>
      )}
    </>
  );
  // Passée et déjà notée : ligne compacte « Départ → Arrivée » avec « Refaire ».
  if (!featured && !r.ongoing && !(r.status === "COMPLETED" && r.rating === null))
    return (
      <li className="flex items-center gap-3 py-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sun/25 text-[22px]" aria-hidden="true">
          🛵
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {r.landmark ?? t("Course Zed")}
            {r.destination && ` → ${r.destination}`}
          </span>
          <span className="block truncate text-[13px] text-stone-500">
            {[
              dateTime(r.createdAt, locale),
              r.status === "CANCELLED" ? (r.cancelledBy === "CUSTOMER" ? t("annulée par vous") : t("annulée")) : r.status === "NO_DRIVER" ? t("aucun Zed") : null,
              r.price !== null ? fcfa(r.price) : null,
              r.rating !== null ? `★ ${r.rating}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <Link href="/app/zed" className="shrink-0 rounded-full bg-stone-100 px-3 py-1.5 text-[13px] font-semibold text-stone-700">
          {t("Refaire")}
        </Link>
      </li>
    );
  return (
    <li className={`${card} mb-2 p-4`}>
      {r.ongoing || (r.status === "COMPLETED" && r.rating === null) ? (
        <Link href="/app/zed" className="block">
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

// Courses Zed du client : seulement avec un compte (l'appel d'un Zed en demande un).
function useRides(enabled: boolean) {
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!enabled) return;
    setError(null);
    customerFetch<Ride[]>("/zed/rides")
      .then(setRides)
      .catch((e) => setError((e as Error).message));
  }, [enabled]);
  useEffect(load, [load]);
  return { rides, error, reload: load };
}

const PANES = [
  { key: "FOOD", label: "Repas", icon: "menu", emoji: "🍗" },
  { key: "PARCEL", label: "Colis", icon: "box", emoji: "📦" },
  { key: "RIDE", label: "Courses Zed", icon: "rider", emoji: "🛵" },
] as const;
type Pane = (typeof PANES)[number]["key"];

// Une liste : d'abord ce qui est en cours, puis l'historique.
function Split<T>({ items, ongoing, render, divided = false }: { items: T[]; ongoing: (x: T) => boolean; render: (x: T) => React.ReactNode; divided?: boolean }) {
  const tr = useT();
  const now = items.filter(ongoing);
  const past = items.filter((x) => !ongoing(x));
  return (
    <div className="space-y-3">
      {now.length > 0 && (
        <>
          <h2 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-emerald-700">{tr("En cours")}</h2>
          <ul className="space-y-3">{now.map(render)}</ul>
        </>
      )}
      {past.length > 0 && (
        <>
          <h2 className="px-1 pt-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">{tr("Passées")}</h2>
          <ul className={divided ? "divide-y divide-stone-200/70" : "space-y-3"}>{past.map(render)}</ul>
        </>
      )}
    </div>
  );
}

// Mes commandes en trois volets côte à côte : Repas, Colis et Courses Zed. On glisse d'un volet à l'autre
// (défilement horizontal aimanté) ou on touche son nom en haut.
export default function Orders() {
  const history = useHistory();
  const session = useSession();
  const tr = useT();
  const rides = useRides(Boolean(session));
  const [pane, setPane] = useState<Pane>("FOOD");
  const track = useRef<HTMLDivElement>(null);
  const all = history.data ?? [];
  const count = (k: Pane) => (k === "RIDE" ? (rides.rides ?? []).filter((r) => r.ongoing).length : all.filter((h) => h.kind === k && h.ongoing).length);

  // Ouverture sur le premier volet qui a quelque chose en cours.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !history.data) return;
    opened.current = true;
    const first = PANES.find((p) => count(p.key) > 0);
    if (first && first.key !== "FOOD") show(first.key, "instant");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.data]);

  function show(k: Pane, behavior: ScrollBehavior = "smooth") {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: PANES.findIndex((p) => p.key === k) * el.clientWidth, behavior });
    setPane(k);
  }
  function onScroll() {
    const el = track.current;
    if (!el) return;
    const k = PANES[Math.round(el.scrollLeft / el.clientWidth)]?.key;
    if (k && k !== pane) setPane(k);
  }

  const empty = (k: Pane) => (
    <Empty icon={k === "RIDE" ? "rider" : "orders"} title={k === "FOOD" ? "Aucun repas commandé" : k === "PARCEL" ? "Aucun colis envoyé" : "Aucune course Zed"}>
      <Link href={k === "FOOD" ? "/app" : k === "PARCEL" ? "/colis" : "/app/zed"} className="text-emerald-700 underline">
        {tr(k === "FOOD" ? "Découvrir les restaurants" : k === "PARCEL" ? "Envoyer un colis" : "Appeler un Zed")}
      </Link>
    </Empty>
  );

  return (
    <div>
      <h1 className="px-4 pb-1 pt-[calc(1rem+env(safe-area-inset-top))] text-[28px] font-bold">{tr("Mes commandes")}</h1>
      <div className="sticky top-0 z-20 bg-stone-50 px-4 pt-2">
        <div role="tablist" className="flex gap-1 rounded-[10px] bg-stone-200/70 p-1">
          {PANES.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={pane === p.key}
              onClick={() => show(p.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-sm transition ${pane === p.key ? "bg-white font-semibold shadow-sm" : "text-stone-600"}`}
            >
              <span aria-hidden="true">{p.emoji}</span>
              {tr(p.label)}
              {count(p.key) > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-600 px-1 text-[11px] font-bold text-white">{count(p.key)}</span>}
            </button>
          ))}
        </div>
        <p className="flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-stone-400" aria-hidden="true">
          {PANES.map((p) => (
            <span key={p.key} className={`h-1.5 rounded-full transition-all ${pane === p.key ? "w-4 bg-emerald-600" : "w-1.5 bg-stone-300"}`} />
          ))}
          <span className="ml-1">{tr("glissez pour changer")}</span>
        </p>
      </div>
      {!history.account && (
        <p className="mx-4 mt-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
          {tr("Vous voyez les commandes passées depuis ce téléphone.")}{" "}
          <Link href="/app/connexion?suite=/app/commandes" className="font-semibold underline">
            {tr("Connectez-vous")}
          </Link>{" "}
          {tr("pour les retrouver partout et commander à nouveau en un geste.")}
        </p>
      )}
      <div ref={track} onScroll={onScroll} data-noswipe className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {PANES.map((p) => (
          <section key={p.key} role="tabpanel" aria-label={tr(p.label)} className="w-full shrink-0 snap-start px-4 py-3">
            {p.key === "RIDE" ? (
              !session ? (
                <Empty icon="rider" title="Connectez-vous pour voir vos courses Zed">
                  <Link href="/app/connexion?suite=/app/commandes" className="text-emerald-700 underline">
                    {tr("Se connecter")}
                  </Link>
                </Empty>
              ) : rides.error ? (
                <Empty icon="rider" title="Chargement impossible">
                  {rides.error}{" "}
                  <button onClick={rides.reload} className="text-emerald-700 underline">
                    {tr("Réessayer")}
                  </button>
                </Empty>
              ) : !rides.rides ? (
                <Skeleton />
              ) : rides.rides.length === 0 ? (
                empty("RIDE")
              ) : (
                <Split items={rides.rides} ongoing={(r) => r.ongoing} render={(r) => <RideEntry key={r.id} r={r} featured={r.id === rides.rides?.find((x) => !x.ongoing)?.id} />} divided />
              )
            ) : history.error ? (
              <Empty icon="orders" title="Chargement impossible">
                {history.error}{" "}
                <button onClick={history.reload} className="text-emerald-700 underline">
                  {tr("Réessayer")}
                </button>
              </Empty>
            ) : history.loading || !history.data ? (
              <Skeleton />
            ) : all.some((h) => h.kind === p.key) ? (
              <Split items={all.filter((h) => h.kind === p.key)} ongoing={(h) => h.ongoing} render={(h) => <Entry key={h.code} h={h} />} divided />
            ) : (
              empty(p.key)
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
