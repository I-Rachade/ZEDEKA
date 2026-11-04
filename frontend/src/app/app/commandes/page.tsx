"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { apiGet, fcfa, type Restaurant } from "@/lib/api";
import { getCart, reorderLines, saveCart } from "@/lib/cart";
import { customerFetch, useSession, type HistoryEntry } from "@/lib/customer";
import { trackHref } from "@/lib/device";
import { useI18n, useT } from "@/lib/i18n/client";
import { useHistory } from "../data";
import { card, dateTime, Empty, KIND, Logo, Skeleton, StatusBadge, TopBar } from "../ui";

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

  return (
    <li className={`${card} p-3`}>
      <Link href={trackHref(h.code)} className="flex gap-3">
        {h.logoUrl ? (
          <Logo url={h.logoUrl} name={h.title} size="h-12 w-12" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600">
            <Icon name={KIND[h.kind].icon} className="h-6 w-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate font-semibold">{t(h.title)}</span>
            <StatusBadge kind={h.kind} status={h.status} />
          </span>
          <span className="block truncate text-sm text-stone-600">{h.subtitle}</span>
          <span className="block text-xs text-stone-500">
            {t(KIND[h.kind].label)} · {h.code} · {dateTime(h.createdAt, locale)} · {fcfa(h.total)}
          </span>
        </span>
      </Link>
      {(h.ongoing || canReorder) && (
        <div className="mt-3 flex gap-2 border-t border-stone-100 pt-3 text-sm">
          {h.ongoing && (
            <Link href={trackHref(h.code)} className="flex-1 rounded-lg bg-emerald-50 py-2 text-center font-medium text-emerald-800">
              {t("Suivre")}
            </Link>
          )}
          {canReorder && (
            <button onClick={reorder} disabled={busy} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-300 py-2 font-medium disabled:opacity-60">
              <Icon name="refresh" className="h-4 w-4" /> {busy ? t("Un instant…") : t("Commander à nouveau")}
            </button>
          )}
        </div>
      )}
    </li>
  );
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

function RideEntry({ r }: { r: Ride }) {
  const { t, locale } = useI18n();
  const minutes = r.onboardAt && r.completedAt ? Math.max(1, Math.round((new Date(r.completedAt).getTime() - new Date(r.onboardAt).getTime()) / 60_000)) : null;
  const body = (
    <>
      <span className="flex gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-sun/30 text-ink">
          <Icon name="rider" className="h-6 w-6" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate font-semibold">
              {r.landmark ? t("Depuis {place}", { place: r.landmark }) : t("Course Zed")}
              {r.destination && ` → ${r.destination}`}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold ${r.ongoing ? "bg-emerald-100 text-emerald-800" : r.status === "COMPLETED" ? "bg-stone-100 text-stone-700" : "bg-red-50 text-red-700"}`}>
              {r.status === "CANCELLED" && r.cancelledBy === "CUSTOMER" ? t("Annulée par vous") : t(RIDE_STATUS[r.status])}
            </span>
          </span>
          <span className="block text-xs text-stone-500">
            {r.code} · {dateTime(r.createdAt, locale)}
            {minutes !== null && ` · ${t("{n} min", { n: minutes })}`}
          </span>
        </span>
      </span>
      {(r.driver || r.price !== null || r.rating !== null) && (
        <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-stone-100 pt-3 text-sm">
          {r.driver && (
            <span className="flex items-center gap-1.5">
              {r.driver.name}
              {r.driver.plate && <span className="rounded-md bg-sun px-1.5 py-0.5 font-mono text-[12px] font-bold text-ink">{r.driver.plate}</span>}
            </span>
          )}
          {r.price !== null && <span className="font-semibold">{fcfa(r.price)}</span>}
          {r.rating !== null && (
            <span className="text-sun" aria-label={t("{n} sur 5", { n: r.rating })}>
              {"★".repeat(r.rating)}
              <span className="text-stone-300">{"★".repeat(5 - r.rating)}</span>
            </span>
          )}
        </span>
      )}
    </>
  );
  return (
    <li className={`${card} p-3`}>
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
  { key: "FOOD", label: "Repas", icon: "menu" },
  { key: "PARCEL", label: "Colis", icon: "box" },
  { key: "RIDE", label: "Courses Zed", icon: "rider" },
] as const;
type Pane = (typeof PANES)[number]["key"];

// Une liste : d'abord ce qui est en cours, puis l'historique.
function Split<T>({ items, ongoing, render }: { items: T[]; ongoing: (x: T) => boolean; render: (x: T) => React.ReactNode }) {
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
          <h2 className="px-1 pt-1 text-[13px] font-semibold uppercase tracking-wide text-stone-500">{tr("Passées")}</h2>
          <ul className="space-y-3">{past.map(render)}</ul>
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
      <TopBar title="Mes commandes" />
      <div className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 bg-stone-50 px-4 pt-3">
        <div role="tablist" className="flex gap-1 rounded-[14px] bg-stone-200/70 p-1">
          {PANES.map((p) => (
            <button
              key={p.key}
              role="tab"
              aria-selected={pane === p.key}
              onClick={() => show(p.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[11px] py-2 text-sm transition ${pane === p.key ? "bg-white font-semibold shadow-sm" : "text-stone-600"}`}
            >
              <Icon name={p.icon} className="h-4 w-4" />
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
                <Split items={rides.rides} ongoing={(r) => r.ongoing} render={(r) => <RideEntry key={r.id} r={r} />} />
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
              <Split items={all.filter((h) => h.kind === p.key)} ongoing={(h) => h.ongoing} render={(h) => <Entry key={h.code} h={h} />} />
            ) : (
              empty(p.key)
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
