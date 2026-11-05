"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon, type IconName } from "@/components/panel/icons";
import { OpenSwitch, useRinging, type OpenState } from "@/components/panel/partner";
import { ErrorNote } from "@/components/panel/ui";
import { fcfa } from "@/lib/api";
import { restaurantClient } from "@/lib/partnerClients";
import { AuthError, logout, restaurantFetch, type Me, type RestaurantOrder } from "@/lib/restaurant";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { ordersChanged, useOnNewOrder } from "../useNewOrders";
import { BoardView, NewOrderAlert, QueueView, SplitView, type Layout, type Lists, type Move } from "./PosViews";
import { setPosMode } from "./mode";
import { useRestaurantRole } from "../RestaurantRole";

const LAYOUT_KEY = "zedeka-pos-layout";
// Commandes mises de côté (« Voir le tableau ») : elles ne réapparaissent pas en grand au rechargement de l'onglet.
const LATER_KEY = "zedeka-pos-later";
const LAYOUTS: { value: Layout; title: string; hint: string; icon: IconName }[] = [
  { value: "tableau", title: "Tableau cuisine", hint: "Trois colonnes : nouvelles, en cuisine, prêtes", icon: "dispatch" },
  { value: "file", title: "File unique", hint: "À accepter et à traiter, la plus urgente en haut", icon: "orders" },
  { value: "caisse", title: "Caisse", hint: "La liste à gauche, le ticket en grand à droite", icon: "receipt" },
];

type Dashboard = { today: { orders: number; sales: number; net: number } };

function readLayout(): Layout {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return v === "file" || v === "caisse" ? v : "tableau";
  } catch {
    return "tableau";
  }
}

export default function PosPage() {
  const router = useRouter();
  const t = useT();
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [me, setMe] = useState<(Me & OpenState) | null>(null);
  const [today, setToday] = useState<Dashboard["today"] | null>(null);
  const [layout, setLayoutState] = useState<Layout>("tableau");
  const [menu, setMenu] = useState(false);
  const [later, setLater] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setLayoutState(readLayout());
    setPosMode(true);
    try {
      setLater(JSON.parse(sessionStorage.getItem(LATER_KEY) ?? "[]"));
    } catch {
      // stockage indisponible
    }
  }, []);
  const snooze = (ids: string[]) => {
    setLater(ids);
    try {
      sessionStorage.setItem(LATER_KEY, JSON.stringify(ids.slice(-100)));
    } catch {
      // stockage indisponible
    }
  };
  const setLayout = (l: Layout) => {
    setLayoutState(l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      // stockage indisponible : l'affichage revient au tableau au prochain chargement
    }
  };

  const load = useCallback(async () => {
    try {
      const [pending, confirmed, preparing, ready] = await Promise.all(
        ["PENDING", "CONFIRMED", "PREPARING", "READY"].map((s) => restaurantFetch<RestaurantOrder[]>(`/orders?status=${s}`)),
      );
      // Les plus anciennes d'abord : c'est l'ordre d'arrivée en cuisine.
      const old = (l: RestaurantOrder[]) => [...l].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      setLists({ pending: old(pending), cooking: old([...confirmed, ...preparing]), ready: old(ready) });
      setError(null);
    } catch (e) {
      if (e instanceof AuthError) router.replace("/restaurant/connexion");
      else setError((e as Error).message);
    }
  }, [router]);
  const loadSide = useCallback(() => {
    restaurantFetch<Me & OpenState>("/me").then(setMe, () => {});
    restaurantFetch<Dashboard>("/dashboard").then((d) => setToday(d.today), () => {});
  }, []);

  useEffect(() => {
    load();
    loadSide();
    const poll = setInterval(load, 8_000);
    const side = setInterval(loadSide, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => (clearInterval(poll), clearInterval(side), clearInterval(tick));
  }, [load, loadSide]);
  useOnNewOrder(load);

  const move: Move = useCallback(
    async (o, status, extra = {}) => {
      setActionError(null);
      try {
        await restaurantFetch(`/orders/${o.id}/status`, { method: "POST", body: { status, ...extra } });
        await load();
        ordersChanged();
        if (status === "DELIVERED") loadSide();
        return true;
      } catch (e) {
        if (e instanceof AuthError) router.replace("/restaurant/connexion");
        else setActionError((e as Error).message);
        await load();
        return false;
      }
    },
    [load, loadSide, router],
  );

  // La plus ancienne commande en attente que le restaurant n'a pas mise de côté s'affiche en grand et sonne.
  const alert = useMemo(() => lists?.pending.find((o) => !later.includes(o.id)) ?? null, [lists, later]);
  const soundBlocked = useRinging(!!alert);

  const views = { tableau: BoardView, file: QueueView, caisse: SplitView };
  const View = views[layout];

  return (
    <div className="flex h-dvh flex-col bg-stone-50 text-ink">
      <header className="flex items-center justify-between gap-2 border-b border-stone-200 bg-white px-3 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-lg font-extrabold text-white">Z</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate font-bold">{me?.name ?? t("Restaurant")}</p>
            <p className="hidden text-xs text-stone-500 sm:block">{t("Mode caisse")}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {today && (
            <div className="hidden text-right leading-tight md:block">
              <p className="text-xs text-stone-500">{t("Aujourd'hui")}</p>
              <p className="text-sm font-bold">
                {t("{n} cmd", { n: today.orders })} · {fcfa(today.sales)}
              </p>
            </div>
          )}
          <OpenSwitch api={restaurantClient} state={me} onChange={loadSide} />
          <button onClick={() => setMenu(true)} className="flex h-10 items-center gap-2 rounded-full bg-stone-100 px-3 text-sm font-semibold text-stone-800" aria-label={t("Plus")}>
            <Icon name="more" />
            <span className="hidden sm:inline">{t("Plus")}</span>
          </button>
        </div>
      </header>

      {(error || actionError) && (
        <div className="px-3 pt-3">
          <ErrorNote message={actionError ?? error} />
        </div>
      )}

      {lists ? (
        <View lists={lists} now={now} move={move} />
      ) : (
        <div className="grid flex-1 place-items-center text-stone-500">{error ? null : t("Chargement…")}</div>
      )}

      {alert && lists && (
        <NewOrderAlert
          key={alert.id}
          o={alert}
          others={lists.pending.length - 1}
          now={now}
          move={move}
          soundBlocked={soundBlocked}
          onLater={() => snooze([...later, ...lists.pending.map((o) => o.id)])}
        />
      )}

      {menu && <PlusMenu layout={layout} setLayout={setLayout} today={today} onClose={() => setMenu(false)} />}
    </div>
  );
}

// Tout ce qui n'est pas une commande en cours : rangé ici, à un geste.
function PlusMenu({ layout, setLayout, today, onClose }: { layout: Layout; setLayout: (l: Layout) => void; today: Dashboard["today"] | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  // La caissière n'a que les commandes et son compte.
  const cashier = useRestaurantRole() === "CASHIER";
  const all: { href: string; icon: IconName; label: string; hint: string }[] = [
    { href: "/restaurant/commandes?statut=DELIVERED", icon: "orders", label: "Commandes terminées", hint: "Livrées, annulées, recherche" },
    { href: "/restaurant/carte", icon: "menu", label: "Carte", hint: "Plats, prix, plats épuisés" },
    { href: "/restaurant/tables", icon: "qr", label: "Tables et QR codes", hint: "Commande sur place" },
    { href: "/restaurant/reglages", icon: "settings", label: "Horaires et réglages", hint: "Ouverture, temps de préparation" },
    { href: "/restaurant/releves", icon: "wallet", label: "Relevés", hint: "Ventes, commissions, versements" },
    { href: "/restaurant/compte", icon: "user", label: "Mon compte", hint: "Mot de passe, équipe" },
  ];
  const links = cashier ? all.filter((l) => /\/(commandes|compte)/.test(l.href)) : all;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={t("Plus")}>
      <button aria-label={t("Fermer")} onClick={onClose} className="absolute inset-0 bg-ink/40" />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-sm flex-col overflow-y-auto bg-stone-50 pb-6 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4">
          <p className="text-xl font-extrabold">{t("Plus")}</p>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <button onClick={onClose} aria-label={t("Fermer")} className="grid h-9 w-9 place-items-center rounded-full bg-stone-200">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
        </div>
        {today && (
          <div className="mx-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-xs text-stone-500">{t("Ventes du jour")}</p>
              <p className="text-lg font-extrabold">{fcfa(today.sales)}</p>
            </div>
            <div className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="text-xs text-stone-500">{t("Pour vous")}</p>
              <p className="text-lg font-extrabold">{fcfa(today.net)}</p>
            </div>
          </div>
        )}

        <p className="px-6 pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-stone-500">{t("Affichage")}</p>
        <div className="mx-4 space-y-2" role="radiogroup" aria-label={t("Affichage")}>
          {LAYOUTS.map((l) => (
            <button
              key={l.value}
              role="radio"
              aria-checked={layout === l.value}
              onClick={() => (setLayout(l.value), onClose())}
              className={`flex w-full items-center gap-3 rounded-xl border-2 bg-white px-4 py-3 text-left ${layout === l.value ? "border-emerald-600" : "border-stone-200"}`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${layout === l.value ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}>
                <Icon name={l.icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{t(l.title)}</span>
                <span className="block text-xs text-stone-500">{t(l.hint)}</span>
              </span>
              {layout === l.value && <Icon name="check" className="h-5 w-5 text-emerald-700" />}
            </button>
          ))}
        </div>

        <p className="px-6 pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-stone-500">{t("Gestion")}</p>
        <div className="mx-4 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="flex items-center gap-3 px-4 py-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-stone-100 text-stone-700">
                <Icon name={l.icon} className="h-[18px] w-[18px]" />
              </span>
              <span className="flex-1">
                <span className="block font-semibold">{t(l.label)}</span>
                <span className="block text-xs text-stone-500">{t(l.hint)}</span>
              </span>
              <Icon name="chevron" className="h-4 w-4 text-stone-400" />
            </Link>
          ))}
        </div>

        <button
          onClick={() => {
            setPosMode(false);
            router.push(cashier ? "/restaurant/commandes" : "/restaurant");
          }}
          className="mx-4 mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-emerald-900"
        >
          <Icon name="home" />
          <span className="flex-1">
            <span className="block font-semibold">{t("Passer en mode complet")}</span>
            <span className="block text-xs">{t("L'espace restaurant habituel, avec le tableau de bord")}</span>
          </span>
        </button>
        <button
          onClick={() => {
            logout();
            router.replace("/restaurant/connexion");
          }}
          className="mx-4 mt-2 flex items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold text-stone-600"
        >
          <Icon name="logout" className="h-4 w-4" />
          {t("Déconnexion")}
        </button>
      </aside>
    </div>
  );
}
