"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, useSession } from "@/lib/customer";
import { useI18n } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import { Empty, Skeleton, TopBar } from "../ui";

// Onglet « Messages » : conversations écrites avec les livreurs. « Actifs » tant que la livraison est en cours,
// « Archives » ensuite (lecture seule, gardées avec la commande). Chaque ligne ouvre le suivi sur la conversation.
export type Conversation = {
  code: string;
  open: boolean;
  title: string;
  driverFirstName: string | null;
  status: string;
  last: { mine: boolean; body: string; at: string } | null;
  unread: number;
  at: string;
};

export default function Messages() {
  const session = useSession();
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"open" | "archive">("open");
  const [list, setList] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    try {
      setList(await customerFetch<Conversation[]>("/messages"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [session]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, { every: 10_000, enabled: !!session });

  const when = (iso: string) => {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" })
      : d.toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "Africa/Lome" });
  };
  const shown = (list ?? []).filter((c) => (tab === "open" ? c.open : !c.open));
  const unreadOpen = (list ?? []).filter((c) => c.open).reduce((n, c) => n + c.unread, 0);

  return (
    <div>
      <TopBar title="Messages" back="/app/commandes" />
      <div role="tablist" className="flex gap-3 px-4 pt-4">
        {(["open", "archive"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[15px] font-semibold transition ${tab === k ? "bg-emerald-600 text-white" : "bg-stone-200/70 text-stone-800"}`}
          >
            {t(k === "open" ? "Actifs" : "Archives")}
            {k === "open" && unreadOpen > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-emerald-700">{unreadOpen}</span>}
          </button>
        ))}
      </div>
      <div className="p-4">
        {!session ? (
          <Empty icon="chat" title="Connectez-vous pour retrouver vos messages">
            <p>{t("Sans compte, écrivez au livreur depuis le suivi de la commande, sur le téléphone qui l'a passée.")}</p>
            <Link href="/app/connexion?suite=/app/messages" className="mt-2 inline-block text-emerald-700 underline">
              {t("Se connecter")}
            </Link>
          </Empty>
        ) : error ? (
          <Empty icon="chat" title="Chargement impossible">
            {error}{" "}
            <button onClick={load} className="text-emerald-700 underline">
              {t("Réessayer")}
            </button>
          </Empty>
        ) : !list ? (
          <Skeleton />
        ) : shown.length === 0 ? (
          <Empty icon="chat" title="Aucune conversation">
            {t(tab === "open" ? "Vos discussions avec le livreur apparaîtront ici dès qu'il aura accepté votre course." : "Les conversations des livraisons terminées sont gardées ici.")}
          </Empty>
        ) : (
          <ul className="card-gloss divide-y divide-stone-100 overflow-hidden rounded-[12px] bg-surface">
            {shown.map((c) => (
              <li key={c.code}>
                <Link href={`/commande/${c.code}?chat=1`} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50">
                  <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-full bg-emerald-600 text-[18px] font-bold text-white" aria-hidden="true">
                    {(c.driverFirstName ?? "?")[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-semibold">{c.driverFirstName ?? t("Votre livreur")}</span>
                      <span className={`shrink-0 text-[12px] tabular-nums ${c.unread ? "font-semibold text-emerald-700" : "text-stone-400"}`}>{when(c.at)}</span>
                    </span>
                    <span className="block truncate text-[12px] text-stone-500">
                      {t(c.title)} · {c.code}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`truncate text-[14px] ${c.unread ? "font-semibold text-stone-900" : "text-stone-500"}`}>
                        {c.last ? `${c.last.mine ? `${t("Vous")} : ` : ""}${c.last.body}` : t("Écrivez au livreur")}
                      </span>
                      {c.unread > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-emerald-600 px-1 text-[11px] font-bold text-white">{c.unread}</span>}
                    </span>
                  </span>
                  {!c.open && <Icon name="lock" className="h-4 w-4 shrink-0 text-stone-300" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
