"use client";

import { useCallback, useEffect, useState } from "react";
import { Empty, input, Skeleton, TopBar } from "@/app/app/ui";
import { useT } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import { merchantFetch, type MerchantParcel } from "@/lib/merchant";
import { ParcelRow } from "../ui";

type Filter = "open" | "done" | "all";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "open", label: "En cours" },
  { value: "done", label: "Terminés" },
  { value: "all", label: "Tous" },
];

// Tous les colis de la boutique, avec recherche sur le client, le téléphone, le code ou le n° de commande.
export default function ParcelsPage() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [list, setList] = useState<MerchantParcel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await merchantFetch<MerchantParcel[]>(`/parcels?filter=${filter}&q=${encodeURIComponent(q)}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter, q]);
  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);
  useLiveRefresh(() => void load(), { every: 30_000 });

  return (
    <div>
      <TopBar title="Mes colis" />
      <div className="space-y-3 px-4 pb-6 pt-3">
        <input type="search" className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Client, téléphone, code ou n° de commande")} aria-label={t("Rechercher un colis")} />
        <div role="tablist" className="flex gap-1 rounded-xl bg-stone-200/70 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => {
                setList(null);
                setFilter(f.value);
              }}
              className={`flex-1 rounded-[10px] py-2 text-[14px] font-semibold transition ${filter === f.value ? "bg-white text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-stone-600"}`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!list ? (
          <Skeleton rows={4} />
        ) : list.length === 0 ? (
          <Empty icon="box" title={q ? "Aucun colis trouvé" : filter === "open" ? "Aucun colis en cours" : "Aucun colis"} />
        ) : (
          <div className="space-y-2.5">
            {list.map((p) => (
              <ParcelRow key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
