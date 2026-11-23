"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/client";
import { MOVEMENT_LABEL, type StockItem, type StockMovement } from "@/lib/logistics";
import { merchantFetch } from "@/lib/merchant";
import { shortDate } from "../ui";

// Gestion de stock de la boutique : articles, prix de vente (caisse), stock en boutique et à l'entrepôt Zedeka,
// seuil d'alerte, entrées et sorties, historique.
export default function StockPage() {
  const t = useT();
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await merchantFetch<StockItem[]>("/stock/items"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !s || i.name.toLowerCase().includes(s) || (i.sku ?? "").toLowerCase().includes(s));
  }, [items, q]);
  const low = (items ?? []).filter((i) => i.low).length;
  const value = (items ?? []).reduce((s, i) => s + (i.price ?? 0) * (i.shopQuantity + i.quantity), 0);

  return (
    <div>
      <TopBar title="Mon stock" back="/marchand" action={<Link href="/marchand/caisse" className="px-2 text-[15px] font-semibold text-emerald-700">{t("Caisse")}</Link>} />
      <div className="space-y-4 px-4 pb-8 pt-4">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Articles" value={items ? String(items.length) : "…"} />
          <Tile label="Stock bas" value={items ? String(low) : "…"} warn={low > 0} />
          <Tile label="Valeur" value={items ? fcfa(value) : "…"} />
        </div>

        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Chercher un article")} aria-label={t("Chercher un article")} className={input} />
          <button type="button" onClick={() => setAdding((v) => !v)} aria-label={t("Nouvel article")} className="grid w-14 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
            <Icon name="plus" className="h-6 w-6" />
          </button>
        </div>

        {adding && (
          <ItemForm
            onDone={async () => {
              setAdding(false);
              await load();
            }}
          />
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!items ? (
          <Skeleton rows={4} />
        ) : shown.length === 0 ? (
          <p className={`${card} p-4 text-sm text-stone-600`}>{items.length ? t("Aucun article ne correspond.") : t("Ajoutez vos articles pour suivre votre stock et vendre à la caisse.")}</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((i) => (
              <li key={i.id} className={`${card} ${i.low ? "ring-2 ring-amber-400" : ""}`}>
                <button type="button" onClick={() => setOpenId(openId === i.id ? null : i.id)} className="flex w-full items-center gap-3 p-3 text-left" aria-expanded={openId === i.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{i.name}</span>
                    <span className="block text-[13px] text-stone-500">
                      {i.price !== null ? fcfa(i.price) : t("Sans prix")}
                      {i.sku ? ` · ${i.sku}` : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[17px] font-bold">{i.shopQuantity}</span>
                    <span className="block text-[11px] text-stone-500">{t("en boutique")}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[17px] font-bold text-sky-800">{i.quantity}</span>
                    <span className="block text-[11px] text-stone-500">{t("entrepôt")}</span>
                  </span>
                </button>
                {i.low && <p className="mx-3 mb-2 rounded-lg bg-amber-50 px-2 py-1 text-[13px] text-amber-900">{t("Stock bas : réapprovisionnez")}</p>}
                {openId === i.id && <ItemPanel item={i} onChange={load} />}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-stone-500">{t("Le stock de l'entrepôt est compté par Zedeka à chaque dépôt, colis et retour.")}</p>
      </div>
    </div>
  );
}

function Tile({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  const t = useT();
  return (
    <div className={`${card} p-3`}>
      <p className="text-[12px] text-stone-500">{t(label)}</p>
      <p className={`truncate text-[17px] font-bold ${warn ? "text-amber-700" : ""}`}>{value}</p>
    </div>
  );
}

const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));

function ItemForm({ item, onDone }: { item?: StockItem; onDone: () => void | Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={`${item ? "" : card} space-y-3 p-3`}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = {
          name: String(f.get("name") ?? ""),
          sku: String(f.get("sku") ?? "") || null,
          price: num(f.get("price")),
          alertAt: num(f.get("alertAt")),
          ...(item ? {} : { shopQuantity: num(f.get("shopQuantity")) ?? 0 }),
        };
        setBusy(true);
        setError(null);
        try {
          await merchantFetch(item ? `/stock/items/${item.id}` : "/stock/items", { method: item ? "PATCH" : "POST", body });
          await onDone();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {!item && <h2 className="font-semibold">{t("Nouvel article")}</h2>}
      <input name="name" required minLength={2} maxLength={80} defaultValue={item?.name} placeholder={t("Nom de l'article")} aria-label={t("Nom de l'article")} className={input} />
      <div className="grid grid-cols-2 gap-2">
        <input name="price" type="number" min={0} defaultValue={item?.price ?? ""} placeholder={t("Prix de vente")} aria-label={t("Prix de vente")} className={input} />
        <input name="sku" maxLength={40} defaultValue={item?.sku ?? ""} placeholder={t("Référence")} aria-label={t("Référence")} className={input} />
        <input name="alertAt" type="number" min={0} defaultValue={item?.alertAt ?? ""} placeholder={t("Alerte sous")} aria-label={t("Alerte de stock bas sous")} className={input} />
        {!item && <input name="shopQuantity" type="number" min={0} placeholder={t("Stock en boutique")} aria-label={t("Stock en boutique")} className={input} />}
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className={primary}>
        {item ? t("Enregistrer") : t("Ajouter l'article")}
      </button>
    </form>
  );
}

function ItemPanel({ item, onChange }: { item: StockItem; onChange: () => Promise<void> }) {
  const t = useT();
  const { locale } = useI18n();
  const [moves, setMoves] = useState<StockMovement[] | null>(null);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const loadMoves = useCallback(() => merchantFetch<StockMovement[]>(`/stock/items/${item.id}/movements`).then(setMoves).catch(() => setMoves([])), [item.id]);
  useEffect(() => {
    loadMoves();
  }, [loadMoves]);

  async function adjust(sign: 1 | -1) {
    setBusy(true);
    setError(null);
    try {
      await merchantFetch(`/stock/items/${item.id}/adjust`, { method: "POST", body: { delta: sign * qty, note: note || undefined } });
      setNote("");
      await Promise.all([onChange(), loadMoves()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await merchantFetch(`/stock/items/${item.id}`, { method: "DELETE" });
      await onChange();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-stone-100 p-3">
      <div className="flex items-center gap-2">
        <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} aria-label={t("Quantité")} className={`${input} w-24`} />
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t("Motif (arrivage, casse…)")} aria-label={t("Motif")} className={input} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => adjust(1)} className={secondary}>
          <Icon name="plus" className="h-5 w-5" /> {t("Entrée")}
        </button>
        <button type="button" disabled={busy} onClick={() => adjust(-1)} className={secondary}>
          {t("Sortie")}
        </button>
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex gap-4 text-sm font-semibold text-emerald-700">
        <button type="button" onClick={() => setEditing((v) => !v)}>
          {t("Modifier")}
        </button>
        <button type="button" disabled={busy} onClick={remove} className="text-red-700">
          {t("Retirer l'article")}
        </button>
      </div>
      {editing && (
        <ItemForm
          item={item}
          onDone={async () => {
            setEditing(false);
            await onChange();
          }}
        />
      )}
      <div>
        <p className="mb-1 text-[13px] font-semibold text-stone-600">{t("Historique")}</p>
        {!moves ? (
          <Skeleton rows={1} />
        ) : moves.length === 0 ? (
          <p className="text-[13px] text-stone-500">{t("Aucun mouvement pour l'instant.")}</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-[13px]">
            {moves.slice(0, 15).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate">
                    {t(MOVEMENT_LABEL[m.kind])} · {m.place === "SHOP" ? t("boutique") : t("entrepôt")}
                  </span>
                  <span className="block truncate text-stone-500">
                    {shortDate(m.createdAt, locale)}
                    {m.note ? ` · ${m.note}` : ""}
                  </span>
                </span>
                <span className={`font-bold ${m.quantity < 0 ? "text-red-700" : "text-emerald-700"}`}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
