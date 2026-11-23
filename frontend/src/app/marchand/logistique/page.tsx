"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { apiGet, fcfa, type ParcelCategory } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/client";
import { DEPOSIT_STATUS, RETURN_STATUS, type Logistics } from "@/lib/logistics";
import { merchantFetch, type Sent } from "@/lib/merchant";
import { shortDate } from "../ui";

type Tab = "entrepot" | "expedier" | "retours" | "frais";

// Logistique Zedeka pour la boutique : stock à l'entrepôt, dépôts de marchandise, expédition d'un colis depuis le
// stock (le livreur ramasse à l'entrepôt, le paiement à la livraison reste le même), retours et frais logistiques.
export default function LogisticsPage() {
  const t = useT();
  const [data, setData] = useState<Logistics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("entrepot");

  const load = useCallback(async () => {
    try {
      setData(await merchantFetch<Logistics>("/logistics"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const tabs: [Tab, string][] = [
    ["entrepot", "Entrepôt"],
    ["expedier", "Expédier"],
    ["retours", "Retours"],
    ["frais", "Frais"],
  ];
  return (
    <div>
      <TopBar title="Logistique" back="/marchand" />
      <div className="space-y-4 px-4 pb-8 pt-3">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-stone-100 p-1" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg py-2 text-[13px] font-semibold ${tab === k ? "bg-surface shadow-sm" : "text-stone-600"}`}>
              {t(label)}
            </button>
          ))}
        </div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data ? (
          <Skeleton rows={4} />
        ) : (
          <>
            {tab === "entrepot" && <Warehouse data={data} reload={load} />}
            {tab === "expedier" && <ShipFromStock data={data} reload={load} />}
            {tab === "retours" && <Returns data={data} />}
            {tab === "frais" && <Charges data={data} />}
          </>
        )}
      </div>
    </div>
  );
}

function Warehouse({ data, reload }: { data: Logistics; reload: () => Promise<void> }) {
  const t = useT();
  const { locale } = useI18n();
  const [lines, setLines] = useState<{ stockItemId: string; name: string; quantity: number; fromShop: boolean }[]>([{ stockItemId: "", name: "", quantity: 1, fromShop: true }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (!data.warehouse)
    return <p className={`${card} p-4 text-sm text-stone-700`}>{t("L'entrepôt Zedeka ouvre bientôt : vous pourrez y stocker votre marchandise et expédier vos colis depuis notre stock.")}</p>;

  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  async function announce() {
    setBusy(true);
    setError(null);
    try {
      await merchantFetch("/logistics/deposits", {
        method: "POST",
        body: { lines: lines.map((l) => (l.stockItemId ? { stockItemId: l.stockItemId, quantity: l.quantity, fromShop: l.fromShop } : { name: l.name, quantity: l.quantity })) },
      });
      setLines([{ stockItemId: "", name: "", quantity: 1, fromShop: true }]);
      setSent(true);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="flex items-center gap-3 rounded-[12px] bg-ink-deep p-4 text-white">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10">
          <Icon name="box" className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{t("{n} article(s) à l'entrepôt", { n: data.units })}</p>
          <p className="truncate text-sm text-white/70">{data.warehouse.address}</p>
          <p className="text-sm text-white/70">{t("Stockage : {amount} par article et par mois", { amount: fcfa(data.fees.storagePerItem) })}</p>
        </div>
      </section>

      {data.items.some((i) => i.quantity > 0) && (
        <ul className={`${card} divide-y divide-stone-100`}>
          {data.items
            .filter((i) => i.quantity > 0)
            .map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="truncate font-medium">{i.name}</span>
                <span className="font-bold">{i.quantity}</span>
              </li>
            ))}
        </ul>
      )}

      <section className={`${card} space-y-3 p-4`}>
        <h2 className="text-lg font-semibold">{t("Annoncer un dépôt")}</h2>
        <p className="text-sm text-stone-600">{t("Déposez votre marchandise à l'entrepôt : l'équipe la compte à l'arrivée et la met dans votre stock.")}</p>
        {lines.map((l, i) => (
          <div key={i} className="space-y-2 rounded-xl bg-stone-50 p-2">
            <select value={l.stockItemId} onChange={(e) => set(i, { stockItemId: e.target.value })} aria-label={t("Article")} className={input}>
              <option value="">{t("Nouvel article")}</option>
              {data.items.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))}
            </select>
            {!l.stockItemId && <input value={l.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={80} placeholder={t("Nom de l'article")} aria-label={t("Nom de l'article")} className={input} />}
            <div className="flex items-center gap-2">
              <input type="number" min={1} value={l.quantity} onChange={(e) => set(i, { quantity: Math.max(1, Number(e.target.value) || 1) })} aria-label={t("Quantité")} className={`${input} w-28`} />
              {l.stockItemId && (
                <label className="flex items-center gap-2 text-[13px] text-stone-700">
                  <input type="checkbox" checked={l.fromShop} onChange={(e) => set(i, { fromShop: e.target.checked })} />
                  {t("Pris dans le stock de la boutique")}
                </label>
              )}
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setLines((ls) => [...ls, { stockItemId: "", name: "", quantity: 1, fromShop: true }])} className="text-sm font-semibold text-emerald-700">
          + {t("Ajouter une ligne")}
        </button>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {sent && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{t("Dépôt annoncé : apportez la marchandise à l'entrepôt.")}</p>}
        <button type="button" disabled={busy} onClick={announce} className={primary}>
          {t("Annoncer le dépôt")}
        </button>
      </section>

      {data.deposits.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{t("Mes dépôts")}</h2>
          <ul className="space-y-2">
            {data.deposits.map((d) => (
              <li key={d.id} className={`${card} p-3 text-sm`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-stone-500">{shortDate(d.createdAt, locale)}</span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${DEPOSIT_STATUS[d.status][1]}`}>{t(DEPOSIT_STATUS[d.status][0])}</span>
                </div>
                <p className="mt-1">{d.lines.map((l) => `${l.received ?? l.quantity} × ${l.name}`).join(", ")}</p>
                {d.status === "PENDING" && (
                  <button
                    type="button"
                    onClick={async () => {
                      await merchantFetch(`/logistics/deposits/${d.id}/cancel`, { method: "POST", body: {} }).catch(() => {});
                      await reload();
                    }}
                    className="mt-1 text-[13px] font-semibold text-red-700"
                  >
                    {t("Annuler le dépôt")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ShipFromStock({ data, reload }: { data: Logistics; reload: () => Promise<void> }) {
  const t = useT();
  const [categories, setCategories] = useState<ParcelCategory[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [payer, setPayer] = useState<"SENDER" | "RECIPIENT">("SENDER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent["parcels"][number] | null>(null);
  useEffect(() => {
    apiGet<ParcelCategory[]>("/api/parcel-categories").then((l) => setCategories(l ?? [])).catch(() => {});
  }, []);

  const available = data.items.filter((i) => i.quantity > 0);
  if (!data.warehouse || available.length === 0)
    return (
      <p className={`${card} p-4 text-sm text-stone-700`}>
        {t("Aucun article à l'entrepôt pour l'instant. Annoncez un dépôt, ou envoyez vos colis depuis la boutique.")}{" "}
        <Link href="/marchand/envoyer" className="font-semibold text-emerald-700 underline">
          {t("Nouvel envoi")}
        </Link>
      </p>
    );

  if (sent)
    return (
      <section className={`${card} space-y-3 p-4`}>
        <p className="text-lg font-semibold">{t("Colis {code} créé", { code: sent.code })}</p>
        <p className="text-sm text-stone-600">{t("Zedeka prépare le colis à l'entrepôt et le confie à un livreur.")}</p>
        <a href={sent.message.whatsappUrl} target="_blank" rel="noreferrer" className={secondary}>
          {t("Prévenir le client sur WhatsApp")}
        </a>
        <button type="button" onClick={() => setSent(null)} className={primary}>
          {t("Expédier un autre colis")}
        </button>
      </section>
    );

  return (
    <form
      className={`${card} space-y-3 p-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const stock = Object.entries(qty)
          .filter(([, n]) => n > 0)
          .map(([stockItemId, quantity]) => ({ stockItemId, quantity }));
        if (!stock.length) {
          setError(t("Choisissez au moins un article"));
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const r = await merchantFetch<Sent>("/parcels", {
            method: "POST",
            body: {
              parcels: [
                {
                  recipientName: String(f.get("recipientName") ?? ""),
                  recipientPhone: String(f.get("recipientPhone") ?? ""),
                  address: String(f.get("address") ?? ""),
                  askRecipientLocation: true,
                  codAmount: Number(f.get("codAmount")) || 0,
                  payer,
                  parcelCategoryId: String(f.get("parcelCategoryId") ?? ""),
                  weightKg: Number(f.get("weightKg")) || 0,
                  stock,
                },
              ],
            },
          });
          setSent(r.parcels[0]);
          setQty({});
          await reload();
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-lg font-semibold">{t("Expédier depuis l'entrepôt")}</h2>
      <ul className="divide-y divide-stone-100">
        {available.map((i) => (
          <li key={i.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{i.name}</span>
              <span className="block text-[12px] text-stone-500">{t("{n} à l'entrepôt", { n: i.quantity })}</span>
            </span>
            <input
              type="number"
              min={0}
              max={i.quantity}
              value={qty[i.id] ?? 0}
              onChange={(e) => setQty((q) => ({ ...q, [i.id]: Math.max(0, Math.min(i.quantity, Number(e.target.value) || 0)) }))}
              aria-label={t("Quantité de {name}", { name: i.name })}
              className={`${input} w-20`}
            />
          </li>
        ))}
      </ul>
      <input name="recipientName" required minLength={2} maxLength={80} placeholder={t("Nom du client")} aria-label={t("Nom du client")} className={input} />
      <input name="recipientPhone" required inputMode="tel" placeholder={t("Téléphone du client")} aria-label={t("Téléphone du client")} className={input} />
      <input name="address" maxLength={300} placeholder={t("Adresse (le client peut aussi partager sa position)")} aria-label={t("Adresse")} className={input} />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-stone-600">{t("À encaisser")}</span>
          <input name="codAmount" type="number" min={0} defaultValue={0} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-stone-600">{t("Poids (kg)")}</span>
          <input name="weightKg" type="number" min={0} step="0.1" defaultValue={1} className={input} />
        </label>
      </div>
      <select name="parcelCategoryId" required aria-label={t("Catégorie")} className={input}>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Livraison payée par")}>
        {(["SENDER", "RECIPIENT"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={payer === p}
            onClick={() => setPayer(p)}
            className={`rounded-full border-2 px-2 py-2 text-sm font-semibold ${payer === p ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-200"}`}
          >
            {p === "SENDER" ? t("Je paie la livraison") : t("Le client paie la livraison")}
          </button>
        ))}
      </div>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className={primary}>
        {t("Créer le colis")}
      </button>
    </form>
  );
}

function Returns({ data }: { data: Logistics }) {
  const t = useT();
  const { locale } = useI18n();
  return (
    <>
      <p className="text-sm text-stone-600">
        {t("Colis refusé, absent ou renvoyé par le client : Zedeka le ramène à l'entrepôt, puis le remet dans votre stock ou vous le rend. Frais de retour : {amount}.", { amount: fcfa(data.fees.returnFee) })}
      </p>
      <p className="text-sm text-stone-600">{t("Pour demander un retour, ouvrez le colis dans « Colis ».")}</p>
      {data.returns.length === 0 ? (
        <p className={`${card} p-4 text-sm text-stone-600`}>{t("Aucun retour.")}</p>
      ) : (
        <ul className="space-y-2">
          {data.returns.map((r) => (
            <li key={r.id}>
              <Link href={`/marchand/colis/${r.code}`} className={`${card} block p-3 text-sm`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {r.code} · {r.recipientName}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-xs font-semibold ${RETURN_STATUS[r.status][1]}`}>{t(RETURN_STATUS[r.status][0])}</span>
                </div>
                <p className="text-stone-600">
                  {t(r.reasonLabel)} · {shortDate(r.createdAt, locale)}
                  {r.fee ? ` · ${fcfa(r.fee)}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Charges({ data }: { data: Logistics }) {
  const t = useT();
  const { locale } = useI18n();
  return (
    <>
      <section className="rounded-[12px] bg-emerald-600 p-4 text-white">
        <p className="text-[13px] text-white/80">{t("Frais à retenir sur le prochain reversement")}</p>
        <p className="text-[30px] font-bold">{fcfa(data.charges.due)}</p>
      </section>
      {[...data.charges.open.map((c) => ({ ...c, done: false })), ...data.charges.withheld.map((c) => ({ ...c, done: true }))].map((c) => (
        <div key={c.id} className={`${card} flex items-center justify-between gap-2 p-3 text-sm`}>
          <span className="min-w-0">
            <span className="block truncate font-medium">{c.label}</span>
            <span className="block text-stone-500">
              {shortDate(c.createdAt, locale)} · {c.done ? t("Retenu") : t("À retenir")}
            </span>
          </span>
          <span className="font-bold">{fcfa(c.amount)}</span>
        </div>
      ))}
      {data.charges.open.length + data.charges.withheld.length === 0 && <p className={`${card} p-4 text-sm text-stone-600`}>{t("Aucun frais logistique.")}</p>}
    </>
  );
}
