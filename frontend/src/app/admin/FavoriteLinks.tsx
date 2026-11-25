"use client";

import { useCallback, useEffect, useState } from "react";
import { askConfirm } from "@/components/AlertDialog";
import { Icon } from "@/components/panel/icons";
import { Card } from "@/components/panel/ui";
import { adminFetch } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";

type Link = {
  id: string;
  rank: number;
  status: "INVITED" | "ACTIVE" | "DECLINED";
  invitedBy: string | null;
  driver: { id: string; name: string; phone: string; staff: boolean; online: boolean };
  owner: { kind: "RESTAURANT" | "MERCHANT"; id: string; name: string } | null;
};

const STATUS: Record<Link["status"], string> = { ACTIVE: "Accepté", INVITED: "Invitation envoyée", DECLINED: "A refusé" };

// Livreurs favoris d'un restaurant, de toutes les boutiques ou d'un livreur (src/favorites.ts côté serveur).
export default function FavoriteLinks({ query, kind, title = "Livreurs favoris" }: { query: string; kind?: "RESTAURANT" | "MERCHANT"; title?: string }) {
  const t = useT();
  const [rows, setRows] = useState<Link[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    adminFetch<Link[]>(`/favorites${query}`).then(
      (r) => setRows(kind ? r.filter((l) => l.owner?.kind === kind) : r),
      (e) => setError((e as Error).message),
    );
  }, [query, kind]);
  useEffect(load, [load]);

  const remove = async (l: Link) => {
    if (!(await askConfirm(t("Retirer {driver} des favoris de {owner} ?", { driver: l.driver.name, owner: l.owner?.name ?? "" }), t("Retirer"), { destructive: true }))) return;
    try {
      await adminFetch(`/favorites/${l.id}`, { method: "DELETE" });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card title={title} icon="heart">
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {!rows ? (
        <p className="text-sm text-stone-500">{t("Chargement")}…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-stone-600">{t("Aucun livreur favori.")}</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {rows.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {!kind || kind === "MERCHANT" ? <strong>{l.owner?.name} → </strong> : null}
                {l.status !== "DECLINED" && <span className="text-stone-500">{l.rank}. </span>}
                {l.driver.name} <span className="text-stone-500">· {l.driver.phone}</span>{" "}
                <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{t(STATUS[l.status])}</span>
                {l.invitedBy && <span className="ml-1 text-xs text-stone-500">{t("par {name}", { name: l.invitedBy })}</span>}
              </span>
              <button type="button" onClick={() => remove(l)} className="rounded-lg border border-stone-300 px-2 py-1" aria-label={t("Retirer")}>
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
