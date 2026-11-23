"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/client";
import { METHOD_LABEL, saleKey, type PosDay, type PosMethod, type PosSale, type StockItem } from "@/lib/logistics";
import { merchantFetch } from "@/lib/merchant";
import { useMerchant } from "../MerchantShell";
import { shortDate } from "../ui";

type Cart = Record<string, number>;

// Caisse (POS) de la boutique : on touche les articles pour remplir le panier, on encaisse en espèces (monnaie
// calculée) ou par mobile money, le ticket s'affiche et s'imprime. Le stock boutique baisse à chaque vente.
export default function CashRegisterPage() {
  const t = useT();
  const [tab, setTab] = useState<"vendre" | "ventes">("vendre");
  return (
    <div>
      <TopBar title="Caisse" back="/marchand" action={<Link href="/marchand/stock" className="px-2 text-[15px] font-semibold text-emerald-700">{t("Stock")}</Link>} />
      <div className="px-4 pt-3 print:hidden">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1" role="tablist">
          {(["vendre", "ventes"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg py-2 text-[15px] font-semibold ${tab === k ? "bg-surface shadow-sm" : "text-stone-600"}`}>
              {k === "vendre" ? t("Vendre") : t("Ventes du jour")}
            </button>
          ))}
        </div>
      </div>
      {tab === "vendre" ? <Sell /> : <Sales />}
    </div>
  );
}

function Sell() {
  const t = useT();
  const [items, setItems] = useState<StockItem[] | null>(null);
  const [cart, setCart] = useState<Cart>({});
  const [q, setQ] = useState("");
  const [method, setMethod] = useState<PosMethod>("CASH");
  const [received, setReceived] = useState("");
  const [discount, setDiscount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<{ sale: PosSale; lowStock: { name: string }[] } | null>(null);
  const [key, setKey] = useState(saleKey);

  const load = useCallback(() => merchantFetch<StockItem[]>("/stock/items").then(setItems).catch((e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
  }, [load]);

  const sellable = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter((i) => i.price !== null && (!s || i.name.toLowerCase().includes(s) || (i.sku ?? "").toLowerCase() === s));
  }, [items, q]);
  const lines = (items ?? []).filter((i) => cart[i.id]).map((i) => ({ item: i, quantity: cart[i.id] }));
  const subtotal = lines.reduce((s, l) => s + (l.item.price ?? 0) * l.quantity, 0);
  const off = Math.min(subtotal, Number(discount) || 0);
  const total = subtotal - off;
  const change = method === "CASH" && received ? Number(received) - total : null;

  const add = (i: StockItem, n = 1) =>
    setCart((c) => {
      const next = Math.max(0, Math.min(i.shopQuantity, (c[i.id] ?? 0) + n));
      const copy = { ...c };
      if (next) copy[i.id] = next;
      else delete copy[i.id];
      return copy;
    });

  async function sell() {
    setBusy(true);
    setError(null);
    try {
      const r = await merchantFetch<{ sale: PosSale; lowStock: { name: string }[] }>("/pos/sales", {
        method: "POST",
        body: {
          lines: lines.map((l) => ({ stockItemId: l.item.id, quantity: l.quantity })),
          discount: off,
          method,
          received: method === "CASH" && received ? Number(received) : null,
          reference: method === "CASH" ? null : reference,
          clientKey: key,
        },
      });
      setTicket(r);
      setCart({});
      setReceived("");
      setDiscount("");
      setReference("");
      setKey(saleKey());
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (ticket) return <Ticket sale={ticket.sale} lowStock={ticket.lowStock} onNext={() => setTicket(null)} />;

  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Chercher ou scanner une référence")} aria-label={t("Chercher un article")} className={input} />
      {!items ? (
        <Skeleton rows={3} />
      ) : sellable.length === 0 ? (
        <p className={`${card} p-4 text-sm text-stone-600`}>
          {t("Aucun article avec un prix de vente.")}{" "}
          <Link href="/marchand/stock" className="font-semibold text-emerald-700 underline">
            {t("Gérer mon stock")}
          </Link>
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {sellable.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                disabled={i.shopQuantity === 0 || (cart[i.id] ?? 0) >= i.shopQuantity}
                onClick={() => add(i)}
                className={`${card} relative flex h-full w-full flex-col items-start gap-1 p-3 text-left active:scale-[0.98] disabled:opacity-40 ${cart[i.id] ? "ring-2 ring-emerald-600" : ""}`}
              >
                <span className="line-clamp-2 font-semibold">{i.name}</span>
                <span className="text-[15px] font-bold text-emerald-800">{fcfa(i.price ?? 0)}</span>
                <span className={`text-[12px] ${i.low ? "text-amber-700" : "text-stone-500"}`}>{t("{n} en boutique", { n: i.shopQuantity })}</span>
                {!!cart[i.id] && <span className="absolute right-2 top-2 grid h-7 min-w-7 place-items-center rounded-full bg-emerald-600 px-2 text-sm font-bold text-white">{cart[i.id]}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <section className={`${card} space-y-3 p-4`}>
          <h2 className="text-lg font-semibold">{t("Panier")}</h2>
          <ul className="divide-y divide-stone-100">
            {lines.map(({ item, quantity }) => (
              <li key={item.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.name}</span>
                  <span className="block text-[13px] text-stone-500">{fcfa((item.price ?? 0) * quantity)}</span>
                </span>
                <button type="button" onClick={() => add(item, -1)} aria-label={t("Retirer un")} className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-lg font-bold">
                  −
                </button>
                <span className="w-6 text-center font-bold">{quantity}</span>
                <button type="button" onClick={() => add(item, 1)} disabled={quantity >= item.shopQuantity} aria-label={t("Ajouter un")} className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-lg font-bold disabled:opacity-40">
                  +
                </button>
              </li>
            ))}
          </ul>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-stone-600">{t("Remise")}</span>
            <input type="number" min={0} value={discount} onChange={(e) => setDiscount(e.target.value)} className={input} />
          </label>
          <div className="flex items-baseline justify-between">
            <span className="font-semibold">{t("Total")}</span>
            <span className="text-[26px] font-extrabold">{fcfa(total)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("Paiement")}>
            {(["CASH", "FLOOZ", "TMONEY"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={method === m}
                onClick={() => setMethod(m)}
                className={`rounded-full border-2 px-2 py-2 text-sm font-semibold ${method === m ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-200"}`}
              >
                {t(METHOD_LABEL[m])}
              </button>
            ))}
          </div>
          {method === "CASH" ? (
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-stone-600">{t("Espèces reçues")}</span>
              <input type="number" min={0} value={received} onChange={(e) => setReceived(e.target.value)} className={input} />
              {change !== null && (
                <span className={`mt-1 block font-semibold ${change < 0 ? "text-red-700" : "text-emerald-800"}`}>
                  {change < 0 ? t("Il manque {amount}", { amount: fcfa(-change) }) : t("Monnaie à rendre : {amount}", { amount: fcfa(change) })}
                </span>
              )}
            </label>
          ) : (
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-stone-600">{t("Référence de la transaction")}</span>
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={40} className={`${input} uppercase`} />
            </label>
          )}
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button type="button" onClick={sell} disabled={busy || (change !== null && change < 0) || (method !== "CASH" && reference.trim().length < 4)} className={primary}>
            <Icon name="check" className="h-5 w-5" /> {t("Encaisser {amount}", { amount: fcfa(total) })}
          </button>
        </section>
      )}
      {error && lines.length === 0 && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function Ticket({ sale, lowStock, onNext }: { sale: PosSale; lowStock: { name: string }[]; onNext: () => void }) {
  const t = useT();
  const { locale } = useI18n();
  const { me } = useMerchant();
  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <section className={`${card} mx-auto max-w-sm space-y-2 p-4 font-mono text-[14px] print:shadow-none`}>
        <p className="text-center text-[16px] font-bold">{me?.merchant?.shopName}</p>
        <p className="text-center text-stone-500">
          {t("Ticket n° {n}", { n: sale.number })} · {shortDate(sale.createdAt, locale)}
        </p>
        <ul className="border-y border-dashed border-stone-300 py-2">
          {sale.lines.map((l) => (
            <li key={l.stockItemId} className="flex justify-between gap-2">
              <span className="truncate">
                {l.quantity} × {l.name}
              </span>
              <span>{fcfa(l.quantity * l.price)}</span>
            </li>
          ))}
        </ul>
        {sale.discount > 0 && (
          <p className="flex justify-between">
            <span>{t("Remise")}</span>
            <span>−{fcfa(sale.discount)}</span>
          </p>
        )}
        <p className="flex justify-between text-[16px] font-bold">
          <span>{t("Total")}</span>
          <span>{fcfa(sale.total)}</span>
        </p>
        <p className="flex justify-between">
          <span>{t(METHOD_LABEL[sale.method])}</span>
          <span>{sale.received != null ? fcfa(sale.received) : sale.reference}</span>
        </p>
        {!!sale.change && (
          <p className="flex justify-between">
            <span>{t("Monnaie rendue")}</span>
            <span>{fcfa(sale.change)}</span>
          </p>
        )}
        <p className="pt-2 text-center text-stone-500">{t("Merci pour votre achat !")}</p>
      </section>
      {lowStock.length > 0 && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 print:hidden">{t("Stock bas : {names}", { names: lowStock.map((l) => l.name).join(", ") })}</p>
      )}
      <div className="grid grid-cols-2 gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className={secondary}>
          <Icon name="print" className="h-5 w-5" /> {t("Imprimer")}
        </button>
        <button type="button" onClick={onNext} className={primary}>
          {t("Vente suivante")}
        </button>
      </div>
    </div>
  );
}

function Sales() {
  const t = useT();
  const { locale } = useI18n();
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<PosDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => merchantFetch<PosDay>(`/pos/sales?day=${day}`).then(setData).catch((e: Error) => setError(e.message)), [day]);
  useEffect(() => {
    load();
  }, [load]);

  async function cancel(s: PosSale) {
    if (!window.confirm(t("Annuler le ticket n° {n} ? Les articles reviennent en stock.", { n: s.number }))) return;
    try {
      await merchantFetch(`/pos/sales/${s.id}/cancel`, { method: "POST", body: {} });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const today = day === new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <input type="date" value={day} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={t("Jour")} className={input} />
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data ? (
        <Skeleton rows={3} />
      ) : (
        <>
          <section className="rounded-[12px] bg-emerald-600 p-4 text-white">
            <p className="text-[13px] text-white/80">{t("{n} vente(s)", { n: data.summary.count })}</p>
            <p className="text-[30px] font-bold">{fcfa(data.summary.total)}</p>
            <p className="text-[13px] text-white/80">
              {(["CASH", "FLOOZ", "TMONEY"] as const).map((m) => `${t(METHOD_LABEL[m])} ${fcfa(data.summary.byMethod[m])}`).join(" · ")}
            </p>
            {data.summary.cancelled > 0 && <p className="text-[13px] text-white/80">{t("{n} annulée(s)", { n: data.summary.cancelled })}</p>}
          </section>
          {data.top.length > 0 && (
            <section className={`${card} p-4`}>
              <h2 className="mb-2 font-semibold">{t("Les plus vendus")}</h2>
              <ul className="space-y-1 text-sm">
                {data.top.map((r) => (
                  <li key={r.name} className="flex justify-between">
                    <span className="truncate">
                      {r.quantity} × {r.name}
                    </span>
                    <span className="font-semibold">{fcfa(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <ul className="space-y-2">
            {data.sales.map((s) => (
              <li key={s.id} className={`${card} p-3 ${s.cancelledAt ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {t("Ticket n° {n}", { n: s.number })} · {fcfa(s.total)}
                  </span>
                  <span className="text-[13px] text-stone-500">{shortDate(s.createdAt, locale)}</span>
                </div>
                <p className="truncate text-[13px] text-stone-600">{s.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}</p>
                <div className="mt-1 flex items-center justify-between text-[13px]">
                  <span>
                    {t(METHOD_LABEL[s.method])}
                    {s.cashier ? ` · ${s.cashier}` : ""}
                  </span>
                  {s.cancelledAt ? (
                    <span className="font-semibold text-red-700">{t("Annulée")}</span>
                  ) : (
                    today && (
                      <button type="button" onClick={() => cancel(s)} className="font-semibold text-red-700">
                        {t("Annuler")}
                      </button>
                    )
                  )}
                </div>
              </li>
            ))}
            {data.sales.length === 0 && <p className={`${card} p-4 text-sm text-stone-600`}>{t("Aucune vente ce jour-là.")}</p>}
          </ul>
        </>
      )}
    </div>
  );
}
