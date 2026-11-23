"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, roleOf, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Merchant = { id: string; shopName: string; phone: string };
type Line = { stockItemId: string | null; name: string; sku: string | null; quantity: number; fromShop?: boolean; received?: number };
type Summary = {
  warehouse: { address: string } | null;
  settings: { warehouseAddress: string; warehouseLatitude: number | null; warehouseLongitude: number | null; storageFeePerItem: number; returnFee: number };
  pendingDeposits: number;
  toPrepare: number;
  returnsToCollect: number;
  returnsAtWarehouse: number;
  units: number;
  merchantsWithStock: number;
  chargesDue: number;
};
type Deposit = { id: string; status: string; lines: Line[]; note: string | null; createdAt: string; receivedAt: string | null; receivedBy: string | null; merchant: Merchant };
type StockLine = { stockItemId: string; name: string; quantity: number };
type Prep = { id: string; code: string; status: string; recipientName: string | null; address: string; codAmount: number; createdAt: string; stockLines: StockLine[]; merchant: Merchant; driver: { name: string; phone: string } | null };
type Movement = { id: string; kind: string; quantity: number; note: string | null; by: string | null; createdAt: string };
type Item = { id: string; name: string; sku: string | null; quantity: number; shopQuantity: number; location: string | null; movements: Movement[] };
type Return = {
  id: string;
  reason: string;
  reasonLabel: string;
  note: string | null;
  status: "TO_COLLECT" | "AT_WAREHOUSE" | "RESTOCKED" | "HANDED_BACK";
  fee: number;
  requestedBy: string;
  createdAt: string;
  merchant: Merchant;
  order: { code: string; recipientName: string | null; recipientPhone: string | null; address: string; stockLines: StockLine[]; driver: { name: string; phone: string } | null };
};
type Charge = { id: string; kind: string; amount: number; label: string; createdAt: string; merchant: Merchant };

type Tab = "depots" | "preparer" | "stock" | "retours" | "frais" | "reglages";
const RETURN_LABEL: Record<Return["status"], string> = { TO_COLLECT: "À ramener", AT_WAREHOUSE: "À l'entrepôt", RESTOCKED: "Remis en stock", HANDED_BACK: "Rendu au marchand" };
const REASONS = [
  ["REFUSED", "Refusé par le destinataire"],
  ["ABSENT", "Destinataire absent ou injoignable"],
  ["DAMAGED", "Colis abîmé"],
  ["CUSTOMER_RETURN", "Renvoyé par le client après livraison"],
  ["OTHER", "Autre motif"],
] as const;

export default function LogisticsAdminPage() {
  return (
    <Suspense fallback={<Loading />}>
      <LogisticsAdmin />
    </Suspense>
  );
}

// Logistique des e-commerçants : dépôts de marchandise à recevoir, colis à préparer depuis le stock, stock de chaque
// marchand à l'entrepôt, retours, frais logistiques retenus sur les reversements, réglages de l'entrepôt.
function LogisticsAdmin() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("onglet") as Tab | null) ?? "depots");
  const { data: s, reload } = useAdmin<Summary>("/logistics/summary");
  const director = roleOf(useStaff()) === "DIRECTOR";
  const t = useI18n().t;
  return (
    <div>
      <PageHeader
        icon="box"
        title="Logistique"
        count={(s?.pendingDeposits ?? 0) + (s?.toPrepare ?? 0) || undefined}
        description="Stockage de la marchandise des e-commerçants à l'entrepôt Zedeka, colis expédiés depuis ce stock (paiement à la livraison reversé comme d'habitude), retours, et frais logistiques retenus sur les reversements."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Dépôts à recevoir" value={s?.pendingDeposits ?? "–"} icon="box" />
        <StatTile label="Colis à préparer" value={s?.toPrepare ?? "–"} icon="bag" />
        <StatTile label="Articles en stock" value={s?.units ?? "–"} hint={s ? t("{n} marchand(s)", { n: s.merchantsWithStock }) : undefined} icon="grid" />
        <StatTile label="Retours en cours" value={s ? s.returnsToCollect + s.returnsAtWarehouse : "–"} hint={s ? t("{amount} de frais à retenir", { amount: fcfa(s.chargesDue) }) : undefined} icon="refresh" />
      </div>
      {s && !s.warehouse && <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Entrepôt fermé : indiquez son adresse dans l'onglet Réglages pour ouvrir le stockage aux marchands.")}</p>}
      <Card>
        <Tabs
          tabs={[
            { value: "depots" as const, label: "Dépôts", count: s?.pendingDeposits },
            { value: "preparer" as const, label: "À préparer", count: s?.toPrepare },
            { value: "stock" as const, label: "Stock" },
            { value: "retours" as const, label: "Retours", count: s ? s.returnsToCollect + s.returnsAtWarehouse : undefined },
            { value: "frais" as const, label: "Frais" },
            ...(director ? [{ value: "reglages" as const, label: "Réglages" }] : []),
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "depots" && <Deposits onChange={reload} />}
        {tab === "preparer" && <ToPrepare />}
        {tab === "stock" && <Stock />}
        {tab === "retours" && <Returns onChange={reload} />}
        {tab === "frais" && <Charges />}
        {tab === "reglages" && s && <Settings settings={s.settings} onSaved={reload} />}
      </Card>
    </div>
  );
}

function Deposits({ onChange }: { onChange: () => void }) {
  const t = useI18n().t;
  const [status, setStatus] = useState<"PENDING" | "RECEIVED">("PENDING");
  const { data, error, reload } = useAdmin<Deposit[]>(`/logistics/deposits?status=${status}`);
  const action = useAction();
  const [counts, setCounts] = useState<Record<string, number[]>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function receive(d: Deposit) {
    const lines = d.lines.map((l, i) => ({ received: counts[d.id]?.[i] ?? l.quantity }));
    setBusy(d.id);
    await action.run(() => adminFetch(`/logistics/deposits/${d.id}/receive`, { method: "POST", body: { lines } }));
    setBusy(null);
    reload();
    onChange();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["PENDING", "RECEIVED"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={status === k ? button : buttonGhost}>
            {k === "PENDING" ? t("À recevoir") : t("Reçus")}
          </button>
        ))}
      </div>
      <ErrorNote message={action.error} />
      {!data ? (
        error ? <ErrorNote message={error} /> : <Loading />
      ) : data.length === 0 ? (
        <Empty>{status === "PENDING" ? "Aucun dépôt à recevoir." : "Aucun dépôt reçu."}</Empty>
      ) : (
        data.map((d) => (
          <div key={d.id} className="rounded-xl border border-stone-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-semibold">{d.merchant.shopName}</span> <span className="text-sm text-stone-500">{d.merchant.phone}</span>
              </span>
              <span className="text-sm text-stone-500">{formatTime(d.createdAt)}</span>
            </div>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={i} className="border-t border-stone-100">
                    <td className="py-1.5">
                      {l.name}
                      {l.sku ? <span className="text-stone-500"> · {l.sku}</span> : null}
                    </td>
                    <td className="py-1.5 text-right text-stone-500">{t("{n} annoncé(s)", { n: l.quantity })}</td>
                    <td className="w-28 py-1.5 pl-2 text-right">
                      {d.status === "PENDING" ? (
                        <input
                          type="number"
                          min={0}
                          defaultValue={l.quantity}
                          aria-label={t("Quantité reçue")}
                          onChange={(e) => setCounts((c) => ({ ...c, [d.id]: d.lines.map((x, j) => (j === i ? Math.max(0, Number(e.target.value) || 0) : (c[d.id]?.[j] ?? x.quantity))) }))}
                          className={`${input} w-24`}
                        />
                      ) : (
                        <span className="font-semibold">{t("{n} reçu(s)", { n: l.received ?? 0 })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.note && <p className="mt-1 text-sm text-stone-600">{d.note}</p>}
            {d.status === "PENDING" ? (
              <button type="button" disabled={busy === d.id} onClick={() => receive(d)} className={`${button} mt-2`}>
                {t("Marchandise reçue et comptée")}
              </button>
            ) : (
              <p className="mt-1 text-sm text-stone-500">{t("Reçu le {date} par {name}", { date: d.receivedAt ? formatTime(d.receivedAt) : "–", name: d.receivedBy ?? "–" })}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function ToPrepare() {
  const t = useI18n().t;
  const { data, error } = useAdmin<Prep[]>("/logistics/to-prepare");
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  if (!data.length) return <Empty>Aucun colis à préparer à l&apos;entrepôt.</Empty>;
  return (
    <ul className="space-y-2">
      {data.map((o) => (
        <li key={o.id} className="rounded-xl border border-stone-200 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={`/admin/commandes/${o.id}`} className="font-mono font-semibold underline">
              {o.code}
            </a>
            <span className="text-stone-500">{formatTime(o.createdAt)}</span>
          </div>
          <p className="font-semibold">{o.stockLines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}</p>
          <p className="text-stone-600">
            {o.merchant.shopName} → {o.recipientName} · {o.address}
          </p>
          <p className="text-stone-600">
            {o.codAmount ? t("{amount} à encaisser", { amount: fcfa(o.codAmount) }) : t("Déjà payé")}
            {o.driver ? ` · ${o.driver.name} ${o.driver.phone}` : ` · ${t("Pas encore de livreur")}`}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Stock() {
  const t = useI18n().t;
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const { data, error } = useAdmin<{ merchant: Merchant; items: number; units: number }[]>("/logistics/stock");
  if (merchantId) return <MerchantStock merchantId={merchantId} onBack={() => setMerchantId(null)} />;
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  if (!data.length) return <Empty>Aucune marchandise à l&apos;entrepôt.</Empty>;
  return (
    <ul className="divide-y divide-stone-100">
      {data.map((r) => (
        <li key={r.merchant.id}>
          <button type="button" onClick={() => setMerchantId(r.merchant.id)} className="flex w-full items-center justify-between gap-2 py-3 text-left">
            <span>
              <span className="font-semibold">{r.merchant.shopName}</span>
              <span className="block text-xs text-stone-500">{r.merchant.phone}</span>
            </span>
            <span className="text-sm">{t("{n} article(s) · {units} en stock", { n: r.items, units: r.units })}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MerchantStock({ merchantId, onBack }: { merchantId: string; onBack: () => void }) {
  const t = useI18n().t;
  const { data, error, reload } = useAdmin<{ merchant: Merchant; items: Item[] }>(`/logistics/stock?merchantId=${merchantId}`);
  const action = useAction();
  async function adjust(item: Item) {
    const raw = window.prompt(t("Correction du stock de « {name} » (ex. -2 ou 5)", { name: item.name }));
    if (!raw) return;
    const note = window.prompt(t("Raison de la correction"));
    if (!note) return;
    await action.run(() => adminFetch(`/logistics/stock/${item.id}/adjust`, { method: "POST", body: { delta: Number(raw), note } }));
    reload();
  }
  async function locate(item: Item) {
    const location = window.prompt(t("Emplacement à l'entrepôt"), item.location ?? "");
    if (location === null) return;
    await action.run(() => adminFetch(`/logistics/stock/${item.id}`, { method: "PATCH", body: { location: location || null } }));
    reload();
  }
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <div className="space-y-3">
      <button type="button" onClick={onBack} className={buttonGhost}>
        ‹ {t("Tous les marchands")}
      </button>
      <h2 className="text-lg font-semibold">{data.merchant.shopName}</h2>
      <ErrorNote message={action.error} />
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-stone-500">
            <th className="py-2">{t("Article")}</th>
            <th className="py-2">{t("Emplacement")}</th>
            <th className="py-2 text-right">{t("Entrepôt")}</th>
            <th className="py-2 text-right">{t("Boutique")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.items.map((i) => (
            <tr key={i.id} className="border-t border-stone-100 align-top">
              <td className="py-2">
                <span className="font-semibold">{i.name}</span>
                {i.sku && <span className="block text-xs text-stone-500">{i.sku}</span>}
                {i.movements.length > 0 && (
                  <span className="block text-xs text-stone-500">
                    {i.movements
                      .slice(0, 3)
                      .map((m) => `${m.quantity > 0 ? "+" : ""}${m.quantity} ${m.kind.toLowerCase()}`)
                      .join(" · ")}
                  </span>
                )}
              </td>
              <td className="py-2">
                <button type="button" onClick={() => locate(i)} className="underline">
                  {i.location ?? t("Ajouter")}
                </button>
              </td>
              <td className="py-2 text-right font-semibold">{i.quantity}</td>
              <td className="py-2 text-right text-stone-500">{i.shopQuantity}</td>
              <td className="py-2 text-right">
                <button type="button" onClick={() => adjust(i)} className={buttonGhost}>
                  {t("Corriger")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Returns({ onChange }: { onChange: () => void }) {
  const t = useI18n().t;
  const [closed, setClosed] = useState(false);
  const { data, error, reload } = useAdmin<Return[]>(`/logistics/returns?status=${closed ? "closed" : "open"}`);
  const action = useAction();
  const [form, setForm] = useState({ code: "", reason: "REFUSED", note: "", waiveFee: false });

  async function move(r: Return, status: "AT_WAREHOUSE" | "RESTOCKED" | "HANDED_BACK") {
    await action.run(() => adminFetch(`/logistics/returns/${r.id}/status`, { method: "POST", body: { status } }));
    reload();
    onChange();
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl bg-stone-50 p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await action.run(() => adminFetch("/logistics/returns", { method: "POST", body: { ...form, note: form.note || undefined } }));
          if (ok) {
            setForm({ code: "", reason: "REFUSED", note: "", waiveFee: false });
            reload();
            onChange();
          }
        }}
      >
        <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={t("Code du colis")} aria-label={t("Code du colis")} className={`${input} w-36`} />
        <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} aria-label={t("Motif")} className={`${input} w-auto`}>
          {REASONS.map(([k, label]) => (
            <option key={k} value={k}>
              {t(label)}
            </option>
          ))}
        </select>
        <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder={t("Précisions")} aria-label={t("Précisions")} className={`${input} w-48`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.waiveFee} onChange={(e) => setForm({ ...form, waiveFee: e.target.checked })} /> {t("Sans frais")}
        </label>
        <button className={button}>{t("Ouvrir un retour")}</button>
      </form>
      <div className="flex gap-2">
        <button type="button" onClick={() => setClosed(false)} className={!closed ? button : buttonGhost}>
          {t("En cours")}
        </button>
        <button type="button" onClick={() => setClosed(true)} className={closed ? button : buttonGhost}>
          {t("Clôturés")}
        </button>
      </div>
      <ErrorNote message={action.error} />
      {!data ? (
        error ? <ErrorNote message={error} /> : <Loading />
      ) : data.length === 0 ? (
        <Empty>Aucun retour.</Empty>
      ) : (
        data.map((r) => (
          <div key={r.id} className="rounded-xl border border-stone-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono font-semibold">{r.order.code}</span>
              <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold">{t(RETURN_LABEL[r.status])}</span>
            </div>
            <p>
              <span className="font-semibold">{r.merchant.shopName}</span> · {t(r.reasonLabel)}
              {r.note ? ` · ${r.note}` : ""}
            </p>
            <p className="text-stone-600">
              {r.order.recipientName} {r.order.recipientPhone} · {r.order.address}
            </p>
            {r.order.stockLines.length > 0 && <p className="text-stone-600">{r.order.stockLines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}</p>}
            <p className="text-stone-500">
              {formatTime(r.createdAt)} · {r.fee ? t("Frais {amount}", { amount: fcfa(r.fee) }) : t("Sans frais")}
              {r.order.driver ? ` · ${r.order.driver.name}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {r.status === "TO_COLLECT" && (
                <button type="button" onClick={() => move(r, "AT_WAREHOUSE")} className={button}>
                  {t("Arrivé à l'entrepôt")}
                </button>
              )}
              {r.status === "AT_WAREHOUSE" && r.order.stockLines.length > 0 && (
                <button type="button" onClick={() => move(r, "RESTOCKED")} className={button}>
                  {t("Remettre en stock")}
                </button>
              )}
              {(r.status === "TO_COLLECT" || r.status === "AT_WAREHOUSE") && (
                <button type="button" onClick={() => move(r, "HANDED_BACK")} className={buttonGhost}>
                  {t("Rendu au marchand")}
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Charges() {
  const t = useI18n().t;
  const { data, error } = useAdmin<Charge[]>("/logistics/charges");
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  if (!data.length) return <Empty>Aucun frais logistique à retenir.</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-stone-600">{t("Ces frais sont retenus automatiquement au prochain reversement de chaque marchand (Finances), dans la limite du montant reversé.")}</p>
      <ul className="divide-y divide-stone-100 text-sm">
        {data.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2 py-2">
            <span>
              <span className="font-semibold">{c.merchant.shopName}</span>
              <span className="block text-stone-500">
                {c.label} · {formatTime(c.createdAt)}
              </span>
            </span>
            <span className="font-semibold">{fcfa(c.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Settings({ settings, onSaved }: { settings: Summary["settings"]; onSaved: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  const [saved, setSaved] = useState(false);
  const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));
  return (
    <form
      className="max-w-xl space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setSaved(false);
        const ok = await action.run(() =>
          adminFetch("/settings/logistics", {
            method: "PATCH",
            body: {
              warehouseAddress: String(f.get("warehouseAddress") ?? ""),
              warehouseLatitude: num(f.get("warehouseLatitude")),
              warehouseLongitude: num(f.get("warehouseLongitude")),
              storageFeePerItem: Number(f.get("storageFeePerItem")) || 0,
              returnFee: Number(f.get("returnFee")) || 0,
            },
          }),
        );
        if (ok) {
          setSaved(true);
          onSaved();
        }
      }}
    >
      <label className="block text-sm">
        {t("Adresse de l'entrepôt (vide : stockage fermé)")}
        <input name="warehouseAddress" defaultValue={settings.warehouseAddress} maxLength={300} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          {t("Latitude")}
          <input name="warehouseLatitude" type="number" step="any" defaultValue={settings.warehouseLatitude ?? ""} className={input} />
        </label>
        <label className="block text-sm">
          {t("Longitude")}
          <input name="warehouseLongitude" type="number" step="any" defaultValue={settings.warehouseLongitude ?? ""} className={input} />
        </label>
        <label className="block text-sm">
          {t("Stockage par article et par mois (FCFA)")}
          <input name="storageFeePerItem" type="number" min={0} defaultValue={settings.storageFeePerItem} className={input} />
        </label>
        <label className="block text-sm">
          {t("Frais de retour d'un colis (FCFA)")}
          <input name="returnFee" type="number" min={0} defaultValue={settings.returnFee} className={input} />
        </label>
      </div>
      <ErrorNote message={action.error} />
      {saved && <p className="text-sm text-emerald-700">{t("Réglages enregistrés.")}</p>}
      <button className={button}>{t("Enregistrer")}</button>
    </form>
  );
}
