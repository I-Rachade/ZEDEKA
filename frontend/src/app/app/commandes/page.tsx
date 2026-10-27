"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { apiGet, fcfa, type Restaurant } from "@/lib/api";
import { getCart, reorderLines, saveCart } from "@/lib/cart";
import type { HistoryEntry } from "@/lib/customer";
import { trackHref } from "@/lib/device";
import { useHistory } from "../data";
import { card, dateTime, Empty, KIND, Logo, Skeleton, StatusBadge, TopBar } from "../ui";

function Entry({ h }: { h: HistoryEntry }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canReorder = h.kind === "FOOD" && !h.ongoing && h.restaurantSlug && h.items?.length;

  // Remet les plats d'une ancienne commande dans le panier ; les prix seront ceux d'aujourd'hui.
  async function reorder() {
    if (!h.restaurantSlug || !h.items) return;
    setBusy(true);
    try {
      const restaurant = await apiGet<Restaurant>(`/api/restaurants/${h.restaurantSlug}`);
      if (!restaurant) throw new Error("Ce restaurant n'est plus sur Zedeka.");
      const { lines, missing } = reorderLines(h.items, restaurant.menuItems);
      if (!lines.length) throw new Error("Ces plats ne sont plus proposés.");
      const current = getCart();
      if (current && current.slug !== restaurant.slug && !window.confirm(`Remplacer le panier de ${current.name} ?`)) return;
      saveCart(restaurant.slug, restaurant.name, lines);
      if (missing.length) window.alert(`Plus disponible : ${missing.join(", ")}. Le reste est dans votre panier.`);
      router.push(`/r/${restaurant.slug}`);
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`${card} p-3`}>
      <Link href={trackHref(h.kind, h.code)} className="flex gap-3">
        {h.logoUrl ? (
          <Logo url={h.logoUrl} name={h.title} size="h-12 w-12" />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600">
            <Icon name={KIND[h.kind].icon} className="h-6 w-6" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate font-semibold">{h.title}</span>
            <StatusBadge kind={h.kind} status={h.status} />
          </span>
          <span className="block truncate text-sm text-stone-600">{h.subtitle}</span>
          <span className="block text-xs text-stone-500">
            {KIND[h.kind].label} · {h.code} · {dateTime(h.createdAt)} · {fcfa(h.total)}
          </span>
        </span>
      </Link>
      {(h.ongoing || canReorder) && (
        <div className="mt-3 flex gap-2 border-t border-stone-100 pt-3 text-sm">
          {h.ongoing && (
            <Link href={trackHref(h.kind, h.code)} className="flex-1 rounded-lg bg-emerald-50 py-2 text-center font-medium text-emerald-800">
              Suivre
            </Link>
          )}
          {canReorder && (
            <button onClick={reorder} disabled={busy} className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-stone-300 py-2 font-medium disabled:opacity-60">
              <Icon name="refresh" className="h-4 w-4" /> {busy ? "Un instant…" : "Commander à nouveau"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function Orders() {
  const history = useHistory();
  const [tab, setTab] = useState<"ongoing" | "past">("ongoing");
  const list = (history.data ?? []).filter((h) => (tab === "ongoing" ? h.ongoing : !h.ongoing));
  const counts = { ongoing: (history.data ?? []).filter((h) => h.ongoing).length, past: (history.data ?? []).filter((h) => !h.ongoing).length };

  return (
    <div>
      <TopBar title="Mes commandes" />
      <div className="sticky top-[57px] z-20 grid grid-cols-2 gap-1 bg-stone-50 px-4 pt-3">
        {(["ongoing", "past"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl py-2 text-sm ${tab === t ? "bg-white font-semibold shadow-sm ring-1 ring-stone-200" : "text-stone-600"}`}
          >
            {t === "ongoing" ? "En cours" : "Passées"} {history.data ? `(${counts[t]})` : ""}
          </button>
        ))}
      </div>
      <div className="space-y-3 px-4 py-4">
        {!history.account && (
          <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
            Vous voyez les commandes passées depuis ce téléphone.{" "}
            <Link href="/app/connexion?suite=/app/commandes" className="font-semibold underline">
              Connectez-vous
            </Link>{" "}
            pour les retrouver partout et commander à nouveau en un geste.
          </p>
        )}
        {history.error ? (
          <Empty icon="orders" title="Chargement impossible">
            {history.error}{" "}
            <button onClick={history.reload} className="text-emerald-700 underline">
              Réessayer
            </button>
          </Empty>
        ) : history.loading || !history.data ? (
          <Skeleton />
        ) : list.length === 0 ? (
          <Empty icon="orders" title={tab === "ongoing" ? "Aucune commande en cours" : "Aucune commande passée"}>
            <Link href="/app" className="text-emerald-700 underline">
              Découvrir les restaurants
            </Link>
          </Empty>
        ) : (
          <ul className="space-y-3">
            {list.map((h) => (
              <Entry key={h.code} h={h} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
