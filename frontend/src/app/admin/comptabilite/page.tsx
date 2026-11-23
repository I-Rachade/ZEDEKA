"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminDownload, adminFetch, editsAccounting, roleOf, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { currentMonth, monthName, PAYMENT_LABEL, PAYSLIP_LABEL, Pill, shiftMonth, shortDate, type PaymentMethod } from "../rh/shared";

type AccountKind = "CASH" | "MOBILE_MONEY" | "BANK" | "OTHER";
type Account = { id: string; name: string; kind: AccountKind; number: string | null; openingBalance: number; active: boolean; totalIn: number; totalOut: number; balance: number };
type Entry = {
  id: string;
  date: string;
  direction: "IN" | "OUT";
  category: string;
  amount: number;
  label: string;
  reference: string | null;
  counterparty: string | null;
  source: "MANUAL" | "PAYROLL" | "TRANSFER";
  createdBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  account: { id: string; name: string; kind: AccountKind } | null;
};
type Totals = { income: number; expense: number; result: number; transfers: number; byCategory: { category: string; direction: "IN" | "OUT"; amount: number; count: number }[] };
type Period = { from: string; to: string };
type Overview = {
  period: Period;
  journal: Totals;
  accounts: Account[];
  cashOnHand: number;
  platform: {
    deliveredOrders: number;
    orderValue: number;
    ordersRevenue: number;
    driverEarnings: number;
    cancellationFees: number;
    cashRemitted: number;
    cashCollections: number;
    restaurantPayouts: number;
    settlementsPaid: number;
    restaurantDeposits: number;
    leasingCollected: number;
    leasingPayments: number;
    zedPlansCollected: number;
    zedPayments: number;
    payrollPaid: number;
    payslipsPaid: number;
    monthlySubscriptions: number;
  };
};
type PayrollToPay = {
  month: string;
  drafts: number;
  toPay: number;
  paid: number;
  payslips: {
    id: string;
    net: number;
    status: "VALIDATED" | "PAID";
    validatedBy: string | null;
    paidAt: string | null;
    paidBy: string | null;
    employee: { id: string; name: string; position: string; paymentMethod: PaymentMethod; paymentAccount: string | null };
  }[];
};
type DriverPay = {
  period: Period;
  rows: { id: string; name: string; phone: string; employment: "STAFF" | "FREELANCE"; monthlySalary: number | null; deliveries: number; earnings: number; cashRemitted: number }[];
  totals: { deliveries: number; earnings: number; cashRemitted: number };
};
type Subscriptions = { rows: { id: string; name: string; type: "RESTAURANT" | "SHOP" | "ONLINE_STORE"; plan: string | null; monthlyFee: number; phone: string }[]; monthlyTotal: number };

const KIND_LABEL: Record<AccountKind, string> = { CASH: "Caisse (espèces)", MOBILE_MONEY: "Mobile money", BANK: "Banque", OTHER: "Autre" };
const CATEGORY_LABEL: Record<string, string> = {
  DELIVERY: "Frais de livraison",
  COMMISSIONS: "Commissions",
  SUBSCRIPTIONS: "Abonnements des commerces",
  LEASING: "Leasing des motos",
  ZED_PLANS: "Plans Zed",
  ADVERTISING: "Publicité vendue",
  CAPITAL: "Apport en capital",
  LOAN: "Emprunt reçu",
  OTHER_INCOME: "Autre recette",
  SALARIES: "Salaires",
  DRIVER_PAYMENTS: "Paiements des livreurs",
  RESTAURANT_PAYOUTS: "Reversements aux commerces",
  RENT: "Loyer",
  ENERGY: "Énergie, carburant, recharge",
  MAINTENANCE: "Entretien et réparations",
  EQUIPMENT: "Matériel et fournitures",
  VEHICLES: "Achat de motos",
  MARKETING: "Marketing et publicité",
  TELECOM: "Téléphone et internet",
  TAXES: "Impôts, taxes, CNSS",
  BANK_FEES: "Frais bancaires et mobile money",
  LOAN_REPAYMENT: "Remboursement d'emprunt",
  OTHER_EXPENSE: "Autre dépense",
  TRANSFER: "Virement entre comptes",
};
const INCOME = ["DELIVERY", "COMMISSIONS", "SUBSCRIPTIONS", "LEASING", "ZED_PLANS", "ADVERTISING", "CAPITAL", "LOAN", "OTHER_INCOME"];
const EXPENSE = ["SALARIES", "DRIVER_PAYMENTS", "RESTAURANT_PAYOUTS", "RENT", "ENERGY", "MAINTENANCE", "EQUIPMENT", "VEHICLES", "MARKETING", "TELECOM", "TAXES", "BANK_FEES", "LOAN_REPAYMENT", "OTHER_EXPENSE"];

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;

type Tab = "synthese" | "journal" | "comptes" | "salaires" | "livreurs" | "abonnements";

export default function AccountingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Accounting />
    </Suspense>
  );
}

// Comptabilité de Zedeka : synthèse d'une période, journal des recettes et dépenses, comptes de trésorerie,
// paiement des salaires validés par les RH, paiements des livreurs et abonnements des commerces.
function Accounting() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("onglet") as Tab | null) ?? "synthese");
  const [period, setPeriod] = useState<Period>({ from: monthStart(), to: today() });
  const edits = editsAccounting(roleOf(useStaff()));
  const t = useI18n().t;

  return (
    <div>
      <PageHeader
        icon="receipt"
        title="Comptabilité"
        description="Recettes et dépenses de Zedeka, soldes de la caisse, du mobile money et de la banque, paiement des salaires validés par les RH, et les chiffres de la plateforme (commandes, abonnements, leasing, Zed, espèces des livreurs, reversements)."
      />
      {(tab === "synthese" || tab === "journal" || tab === "livreurs") && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium">{t("Du")}</span>
            <input type="date" value={period.from} onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })} className={`${input} w-auto`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium">{t("Au")}</span>
            <input type="date" value={period.to} onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })} className={`${input} w-auto`} />
          </label>
          <button className={buttonGhost} onClick={() => setPeriod({ from: monthStart(), to: today() })}>
            {t("Ce mois-ci")}
          </button>
          <button
            className={buttonGhost}
            onClick={() => {
              const m = shiftMonth(currentMonth(), -1);
              const last = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
              setPeriod({ from: `${m}-01`, to: last });
            }}
          >
            {t("Mois dernier")}
          </button>
          <button className={buttonGhost} onClick={() => setPeriod({ from: `${today().slice(0, 4)}-01-01`, to: today() })}>
            {t("Cette année")}
          </button>
        </div>
      )}
      <Card>
        <Tabs
          tabs={[
            { value: "synthese" as const, label: "Synthèse" },
            { value: "journal" as const, label: "Journal" },
            { value: "comptes" as const, label: "Comptes" },
            { value: "salaires" as const, label: "Salaires" },
            { value: "livreurs" as const, label: "Livreurs" },
            { value: "abonnements" as const, label: "Abonnements" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "synthese" && <OverviewTab period={period} />}
        {tab === "journal" && <Journal period={period} edits={edits} />}
        {tab === "comptes" && <Accounts edits={edits} />}
        {tab === "salaires" && <Salaries edits={edits} />}
        {tab === "livreurs" && <Drivers period={period} />}
        {tab === "abonnements" && <SubscriptionsTab />}
      </Card>
    </div>
  );
}

function Line({ label, value, hint, strong = false }: { label: string; value: string; hint?: string; strong?: boolean }) {
  const t = useI18n().t;
  return (
    <div className="flex justify-between gap-3 border-b border-stone-100 py-1.5 text-sm last:border-0">
      <span className="text-stone-600">
        {t(label)}
        {hint && <span className="block text-xs text-stone-500">{hint}</span>}
      </span>
      <span className={strong ? "font-bold" : "font-medium"}>{value}</span>
    </div>
  );
}

function OverviewTab({ period }: { period: Period }) {
  const t = useI18n().t;
  const { data, error } = useAdmin<Overview>(`/accounting/overview?from=${period.from}&to=${period.to}`);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  const { journal: j, platform: p } = data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Recettes (journal)" value={fcfa(j.income)} icon="wallet" />
        <StatTile label="Dépenses (journal)" value={fcfa(j.expense)} icon="receipt" />
        <StatTile label="Résultat" value={fcfa(j.result)} hint={j.result < 0 ? "Plus de dépenses que de recettes" : undefined} icon="chart" />
        <StatTile label="Trésorerie (tous les comptes)" value={fcfa(data.cashOnHand)} icon="wallet" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 font-semibold">{t("Chiffres de la plateforme")}</h3>
          <p className="mb-2 text-xs text-stone-500">{t("Relus des commandes, encaissements et paiements enregistrés dans l'admin, sans double saisie.")}</p>
          <Line label="Commandes livrées" value={String(p.deliveredOrders)} hint={t("{amount} payés par les clients", { amount: fcfa(p.orderValue) })} />
          <Line label="Revenu des commandes" value={fcfa(p.ordersRevenue)} hint={t("Livraison et commissions, moins remises et part des livreurs")} strong />
          <Line label="Frais d'annulation" value={fcfa(p.cancellationFees)} />
          <Line label="Part des livreurs indépendants" value={fcfa(p.driverEarnings)} />
          <Line label="Espèces remises par les livreurs" value={fcfa(p.cashRemitted)} hint={t("{n} encaissement(s)", { n: p.cashCollections })} />
          <Line label="Reversements payés aux commerces" value={fcfa(p.restaurantPayouts)} hint={t("{n} relevé(s)", { n: p.settlementsPaid })} />
          <Line label="Dépôts chez les restaurants" value={fcfa(p.restaurantDeposits)} />
          <Line label="Leasing des motos encaissé" value={fcfa(p.leasingCollected)} hint={t("{n} paiement(s)", { n: p.leasingPayments })} />
          <Line label="Plans Zed encaissés" value={fcfa(p.zedPlansCollected)} hint={t("{n} paiement(s)", { n: p.zedPayments })} />
          <Line label="Salaires payés" value={fcfa(p.payrollPaid)} hint={t("{n} bulletin(s)", { n: p.payslipsPaid })} />
          <Line label="Abonnements attendus par mois" value={fcfa(p.monthlySubscriptions)} />
        </section>
        <section className="space-y-4">
          <div>
            <h3 className="mb-2 font-semibold">{t("Journal par catégorie")}</h3>
            {j.byCategory.length === 0 ? (
              <Empty>Aucune écriture sur cette période.</Empty>
            ) : (
              j.byCategory.map((c) => <Line key={`${c.direction}${c.category}`} label={CATEGORY_LABEL[c.category] ?? c.category} hint={t("{n} écriture(s)", { n: c.count })} value={`${c.direction === "IN" ? "+" : "−"} ${fcfa(c.amount)}`} />)
            )}
          </div>
          <div>
            <h3 className="mb-2 font-semibold">{t("Soldes des comptes (aujourd'hui)")}</h3>
            {data.accounts.length === 0 ? <Empty>{"Aucun compte : créez la caisse, le mobile money et la banque dans l'onglet Comptes."}</Empty> : data.accounts.map((a) => <Line key={a.id} label={a.name} hint={t(KIND_LABEL[a.kind])} value={fcfa(a.balance)} />)}
          </div>
        </section>
      </div>
    </div>
  );
}

function Journal({ period, edits }: { period: Period; edits: boolean }) {
  const { t, locale } = useI18n();
  const [direction, setDirection] = useState<"" | "IN" | "OUT">("");
  const [category, setCategory] = useState("");
  const [accountId, setAccountId] = useState("");
  const [q, setQ] = useState("");
  const [voided, setVoided] = useState(false);
  const qs = `from=${period.from}&to=${period.to}&direction=${direction}&category=${category}&accountId=${accountId}&q=${encodeURIComponent(q)}&voided=${voided ? 1 : 0}`;
  const { data, error, reload } = useAdmin<{ entries: Entry[]; totals: Totals }>(`/accounting/entries?${qs}`);
  const accounts = useAdmin<Account[]>("/accounting/accounts");
  const action = useAction();
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={direction} onChange={(e) => setDirection(e.target.value as "" | "IN" | "OUT")} aria-label={t("Sens")} className={`${input} w-auto`}>
          <option value="">{t("Recettes et dépenses")}</option>
          <option value="IN">{t("Recettes")}</option>
          <option value="OUT">{t("Dépenses")}</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t("Catégorie")} className={`${input} w-auto`}>
          <option value="">{t("Toutes les catégories")}</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {t(v)}
            </option>
          ))}
        </select>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label={t("Compte")} className={`${input} w-auto`}>
          <option value="">{t("Tous les comptes")}</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Libellé, référence, tiers")} aria-label={t("Rechercher une écriture")} className={`${input} max-w-xs`} />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={voided} onChange={(e) => setVoided(e.target.checked)} />
          {t("Voir les écritures annulées")}
        </label>
        <span className="flex-1" />
        <button className={buttonGhost} onClick={() => action.run(() => adminDownload(`/accounting/export?${qs}`, `journal-${period.from}-${period.to}.csv`))}>
          {t("Exporter (CSV)")}
        </button>
        {edits && !adding && (
          <button className={button} onClick={() => setAdding(true)}>
            {t("Nouvelle écriture")}
          </button>
        )}
      </div>
      {adding && <EntryForm accounts={accounts.data ?? []} onDone={async () => (setAdding(false), await reload())} onCancel={() => setAdding(false)} />}
      <ErrorNote message={action.error ?? error} />
      {data && (
        <p className="text-sm">
          {t("Recettes {income} · Dépenses {expense} · Résultat {result}", { income: fcfa(data.totals.income), expense: fcfa(data.totals.expense), result: fcfa(data.totals.result) })}
        </p>
      )}
      {!data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.entries}
          rowKey={(e) => e.id}
          empty="Aucune écriture sur cette période."
          columns={[
            {
              header: "Libellé",
              mobile: "title",
              cell: (e) => (
                <span className={e.voidedAt ? "line-through opacity-60" : ""}>
                  <span className="font-semibold">{e.label}</span>
                  <span className="block text-xs text-stone-500">
                    {t(CATEGORY_LABEL[e.category] ?? e.category)}
                    {e.counterparty ? ` · ${e.counterparty}` : ""}
                    {e.reference ? ` · ${e.reference}` : ""}
                  </span>
                </span>
              ),
            },
            {
              header: "Montant",
              mobile: "badge",
              align: "right",
              cell: (e) => <span className={`font-semibold ${e.voidedAt ? "line-through opacity-60" : e.direction === "IN" ? "text-emerald-700" : "text-red-700"}`}>{`${e.direction === "IN" ? "+" : "−"} ${fcfa(e.amount)}`}</span>,
            },
            { header: "Date", cell: (e) => shortDate(e.date, locale) },
            { header: "Compte", cell: (e) => e.account?.name ?? "–" },
            {
              header: "Saisie",
              cell: (e) =>
                e.voidedAt ? (
                  <span className="text-xs text-red-700">{t("Annulée par {name} : {reason}", { name: e.voidedBy ?? "?", reason: e.voidReason ?? "" })}</span>
                ) : (
                  <span className="text-xs text-stone-500">{e.source === "PAYROLL" ? t("Paie · {name}", { name: e.createdBy ?? "" }) : e.createdBy}</span>
                ),
            },
            {
              header: "",
              cell: (e) =>
                edits && !e.voidedAt ? (
                  <button
                    className="text-xs text-red-700 underline"
                    onClick={() => {
                      const reason = window.prompt(
                        t(e.source === "TRANSFER" ? "Annuler ce virement (ses deux écritures) ? Motif :" : e.source === "PAYROLL" ? "Annuler ce paiement de salaire ? Le bulletin redeviendra à payer. Motif :" : "Annuler cette écriture ? Motif :"),
                      );
                      if (!reason) return;
                      action.run(async () => {
                        await adminFetch(`/accounting/entries/${e.id}/void`, { method: "POST", body: { reason } });
                        await reload();
                      });
                    }}
                  >
                    {t("Annuler")}
                  </button>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  );
}

function EntryForm({ accounts, onDone, onCancel }: { accounts: Account[]; onDone: () => Promise<void>; onCancel: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const categories = direction === "IN" ? INCOME : EXPENSE;
  return (
    <form
      className="grid gap-2 rounded-lg bg-stone-50 p-3 sm:grid-cols-3"
      onSubmit={(ev) => {
        ev.preventDefault();
        const f = new FormData(ev.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "").trim();
        action.run(async () => {
          await adminFetch("/accounting/entries", {
            method: "POST",
            body: { direction, date: s("date"), category: s("category"), amount: Number(s("amount")), accountId: s("accountId") || null, label: s("label"), reference: s("reference") || null, counterparty: s("counterparty") || null },
          });
          await onDone();
        });
      }}
    >
      <div className="flex gap-1 sm:col-span-3" role="radiogroup" aria-label={t("Sens")}>
        {(["OUT", "IN"] as const).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)} className={direction === d ? button : buttonGhost}>
            {t(d === "IN" ? "Recette" : "Dépense")}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("Date")}</span>
        <input name="date" type="date" required defaultValue={today()} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("Catégorie")}</span>
        <select name="category" key={direction} required className={input}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {t(CATEGORY_LABEL[c])}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("Montant (FCFA)")}</span>
        <input name="amount" type="number" min={1} step={1} required className={input} />
      </label>
      <label className="block sm:col-span-2">
        <span className="mb-1 block text-sm font-medium">{t("Libellé")}</span>
        <input name="label" required minLength={2} maxLength={160} placeholder={t("ex. Loyer du bureau de novembre")} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("Compte")}</span>
        <select name="accountId" className={input} defaultValue={accounts.find((a) => a.active)?.id ?? ""}>
          <option value="">{t("Aucun compte")}</option>
          {accounts
            .filter((a) => a.active)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("Tiers (fournisseur, client…)")}</span>
        <input name="counterparty" maxLength={120} className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("Référence (facture, transaction)")}</span>
        <input name="reference" maxLength={80} className={input} />
      </label>
      <div className="flex items-end gap-2">
        <button className={button}>{t("Enregistrer")}</button>
        <button type="button" onClick={onCancel} className={buttonGhost}>
          {t("Annuler")}
        </button>
      </div>
      <div className="sm:col-span-3">
        <ErrorNote message={action.error} />
      </div>
    </form>
  );
}

function Accounts({ edits }: { edits: boolean }) {
  const t = useI18n().t;
  const { data, error, reload } = useAdmin<Account[]>("/accounting/accounts");
  const action = useAction();
  const active = data?.filter((a) => a.active) ?? [];
  return (
    <div className="space-y-4">
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data}
          rowKey={(a) => a.id}
          empty="Aucun compte : créez la caisse, le mobile money et la banque ci-dessous."
          columns={[
            {
              header: "Compte",
              mobile: "title",
              cell: (a) => (
                <span className={a.active ? "" : "opacity-60"}>
                  <span className="font-semibold">{a.name}</span>
                  <span className="block text-xs text-stone-500">
                    {t(KIND_LABEL[a.kind])}
                    {a.number ? ` · ${a.number}` : ""}
                    {a.active ? "" : ` · ${t("fermé")}`}
                  </span>
                </span>
              ),
            },
            { header: "Solde", mobile: "badge", align: "right", cell: (a) => <strong>{fcfa(a.balance)}</strong> },
            { header: "Solde d'ouverture", align: "right", cell: (a) => fcfa(a.openingBalance) },
            { header: "Entrées", align: "right", cell: (a) => fcfa(a.totalIn) },
            { header: "Sorties", align: "right", cell: (a) => fcfa(a.totalOut) },
            {
              header: "",
              cell: (a) =>
                edits ? (
                  <button className="text-xs underline" onClick={() => action.run(async () => (await adminFetch(`/accounting/accounts/${a.id}`, { method: "PATCH", body: { active: !a.active } }), await reload()))}>
                    {a.active ? t("Fermer") : t("Rouvrir")}
                  </button>
                ) : null,
            },
          ]}
        />
      )}
      {edits && (
        <div className="grid gap-4 lg:grid-cols-2">
          <form
            className="grid gap-2 rounded-lg bg-stone-50 p-3"
            onSubmit={(ev) => {
              ev.preventDefault();
              const form = ev.currentTarget;
              const f = new FormData(form);
              action.run(async () => {
                await adminFetch("/accounting/accounts", {
                  method: "POST",
                  body: { name: String(f.get("name")).trim(), kind: f.get("kind"), number: String(f.get("number") ?? "").trim() || null, openingBalance: Number(f.get("openingBalance") || 0) },
                });
                form.reset();
                await reload();
              });
            }}
          >
            <h3 className="font-semibold">{t("Nouveau compte")}</h3>
            <input name="name" required minLength={2} maxLength={80} placeholder={t("ex. Caisse du bureau, Flooz Zedeka, Banque")} aria-label={t("Nom du compte")} className={input} />
            <select name="kind" aria-label={t("Type de compte")} className={input} defaultValue="CASH">
              {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => (
                <option key={k} value={k}>
                  {t(KIND_LABEL[k])}
                </option>
              ))}
            </select>
            <input name="number" maxLength={80} placeholder={t("Numéro (téléphone, compte bancaire), facultatif")} aria-label={t("Numéro du compte")} className={input} />
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t("Solde au départ (FCFA)")}</span>
              <input name="openingBalance" type="number" step={1} defaultValue={0} className={input} />
            </label>
            <button className={button}>{t("Créer le compte")}</button>
          </form>
          {active.length >= 2 && (
            <form
              className="grid gap-2 rounded-lg bg-stone-50 p-3"
              onSubmit={(ev) => {
                ev.preventDefault();
                const form = ev.currentTarget;
                const f = new FormData(form);
                action.run(async () => {
                  await adminFetch("/accounting/transfers", {
                    method: "POST",
                    body: { date: f.get("date"), fromAccountId: f.get("from"), toAccountId: f.get("to"), amount: Number(f.get("amount")), label: String(f.get("label") ?? "").trim() || null },
                  });
                  form.reset();
                  await reload();
                });
              }}
            >
              <h3 className="font-semibold">{t("Virement entre comptes")}</h3>
              <p className="text-xs text-stone-500">{t("Ex. dépôt des espèces de la caisse à la banque. Ni recette ni dépense : seuls les soldes changent.")}</p>
              <select name="from" required aria-label={t("Depuis le compte")} className={input} defaultValue={active[0].id}>
                {active.map((a) => (
                  <option key={a.id} value={a.id}>
                    {t("Depuis : {name}", { name: a.name })}
                  </option>
                ))}
              </select>
              <select name="to" required aria-label={t("Vers le compte")} className={input} defaultValue={active[1].id}>
                {active.map((a) => (
                  <option key={a.id} value={a.id}>
                    {t("Vers : {name}", { name: a.name })}
                  </option>
                ))}
              </select>
              <input name="amount" type="number" min={1} step={1} required placeholder={t("Montant (FCFA)")} aria-label={t("Montant (FCFA)")} className={input} />
              <input name="date" type="date" required defaultValue={today()} aria-label={t("Date")} className={input} />
              <input name="label" maxLength={160} placeholder={t("Libellé (facultatif)")} aria-label={t("Libellé")} className={input} />
              <button className={button}>{t("Enregistrer le virement")}</button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Salaries({ edits }: { edits: boolean }) {
  const { t, locale } = useI18n();
  const [month, setMonth] = useState(currentMonth());
  const { data, error, reload } = useAdmin<PayrollToPay>(`/accounting/payroll?month=${month}`);
  const accounts = useAdmin<Account[]>("/accounting/accounts");
  const active = accounts.data?.filter((a) => a.active) ?? [];
  const [accountId, setAccountId] = useState("");
  const chosen = accountId || active[0]?.id || "";
  const action = useAction();
  const toPay = data?.payslips.filter((p) => p.status === "VALIDATED") ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className={buttonGhost} onClick={() => setMonth(shiftMonth(month, -1))} aria-label={t("Mois précédent")}>
          ←
        </button>
        <span className="min-w-36 text-center font-semibold capitalize">{monthName(month, locale)}</span>
        <button className={buttonGhost} onClick={() => setMonth(shiftMonth(month, 1))} aria-label={t("Mois suivant")}>
          →
        </button>
        <span className="flex-1" />
        {edits && active.length > 0 && (
          <select value={chosen} onChange={(e) => setAccountId(e.target.value)} aria-label={t("Compte qui paie")} className={`${input} w-auto`}>
            {active.map((a) => (
              <option key={a.id} value={a.id}>
                {t("Payer depuis : {name}", { name: a.name })}
              </option>
            ))}
          </select>
        )}
        {edits && toPay.length > 1 && chosen && (
          <button
            className={button}
            onClick={() => {
              if (!window.confirm(t("Payer les {n} salaires validés ({amount}) ?", { n: toPay.length, amount: fcfa(data?.toPay ?? 0) }))) return;
              action.run(async () => {
                await adminFetch("/accounting/payroll/pay", { method: "POST", body: { month, accountId: chosen } });
                await reload();
              });
            }}
          >
            {t("Tout payer")}
          </button>
        )}
      </div>
      <p className="text-sm text-stone-600">{t("Les ressources humaines préparent et valident les bulletins. Chaque salaire payé ici est écrit au journal (« Salaires ») sur le compte choisi.")}</p>
      {edits && accounts.data && active.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("Créez d'abord un compte (onglet Comptes) pour payer les salaires.")}</p>}
      {data && data.drafts > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t("{n} bulletin(s) encore en brouillon chez les ressources humaines.", { n: data.drafts })}</p>}
      <ErrorNote message={action.error ?? error} />
      {data && (
        <p className="text-sm">
          {t("À payer {toPay} · Déjà payé {paid}", { toPay: fcfa(data.toPay), paid: fcfa(data.paid) })}
        </p>
      )}
      {!data ? (
        <Loading />
      ) : (
        <DataTable
          rows={data.payslips}
          rowKey={(p) => p.id}
          empty="Aucun salaire validé pour ce mois."
          columns={[
            {
              header: "Employé",
              mobile: "title",
              cell: (p) => (
                <span>
                  <span className="font-semibold">{p.employee.name}</span>
                  <span className="block text-xs text-stone-500">{p.employee.position}</span>
                </span>
              ),
            },
            { header: "Net", mobile: "badge", align: "right", cell: (p) => <strong>{fcfa(p.net)}</strong> },
            { header: "Paiement", cell: (p) => `${t(PAYMENT_LABEL[p.employee.paymentMethod])}${p.employee.paymentAccount ? ` · ${p.employee.paymentAccount}` : ""}` },
            {
              header: "État",
              cell: (p) => (
                <span>
                  <Pill status={p.status} label={PAYSLIP_LABEL[p.status]} />
                  {p.status === "PAID" && <span className="block text-xs text-stone-500">{t("le {date} par {name}", { date: shortDate(p.paidAt, locale), name: p.paidBy ?? "" })}</span>}
                </span>
              ),
            },
            {
              header: "",
              cell: (p) =>
                edits && p.status === "VALIDATED" && chosen ? (
                  <button
                    className={button}
                    onClick={() => {
                      const reference = window.prompt(t("Payer {amount} à {name}. Référence de la transaction (facultatif) :", { amount: fcfa(p.net), name: p.employee.name }));
                      if (reference === null) return;
                      action.run(async () => {
                        await adminFetch(`/accounting/payslips/${p.id}/pay`, { method: "POST", body: { accountId: chosen, reference: reference.trim() || null } });
                        await reload();
                      });
                    }}
                  >
                    {t("Payer")}
                  </button>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  );
}

function Drivers({ period }: { period: Period }) {
  const t = useI18n().t;
  const { data, error } = useAdmin<DriverPay>(`/accounting/drivers?from=${period.from}&to=${period.to}`);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-600">
        {t("Ce que chaque livreur a gagné par ses courses (indépendants), son salaire (salariés, payé par la paie des RH) et les espèces remises à Zedeka. Les espèces se récupèrent dans")}{" "}
        <Link href="/admin/finances" className="underline">
          {t("Finances")}
        </Link>
        .
      </p>
      <p className="text-sm">{t("{n} course(s) · {earnings} gagnés par les livreurs · {cash} d'espèces remises", { n: data.totals.deliveries, earnings: fcfa(data.totals.earnings), cash: fcfa(data.totals.cashRemitted) })}</p>
      <DataTable
        rows={data.rows}
        rowKey={(r) => r.id}
        empty="Aucune course ni encaissement sur cette période."
        columns={[
          {
            header: "Livreur",
            mobile: "title",
            cell: (r) => (
              <span>
                <span className="font-semibold">{r.name}</span>
                <span className="block text-xs text-stone-500">{r.phone}</span>
              </span>
            ),
          },
          { header: "Statut", mobile: "badge", cell: (r) => t(r.employment === "STAFF" ? "Salarié" : "Indépendant") },
          { header: "Courses", align: "right", cell: (r) => r.deliveries },
          { header: "Gains des courses", align: "right", cell: (r) => fcfa(r.earnings) },
          { header: "Salaire mensuel", align: "right", cell: (r) => (r.monthlySalary !== null ? fcfa(r.monthlySalary) : "–") },
          { header: "Espèces remises", align: "right", cell: (r) => fcfa(r.cashRemitted) },
        ]}
      />
    </div>
  );
}

function SubscriptionsTab() {
  const t = useI18n().t;
  const { data, error } = useAdmin<Subscriptions>("/accounting/subscriptions");
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  const TYPE: Record<Subscriptions["rows"][number]["type"], string> = { RESTAURANT: "Restaurant", SHOP: "Boutique", ONLINE_STORE: "Boutique en ligne" };
  return (
    <div className="space-y-3">
      <p className="text-sm">{t("{n} commerce(s) abonné(s) · {amount} attendus par mois", { n: data.rows.length, amount: fcfa(data.monthlyTotal) })}</p>
      <DataTable
        rows={data.rows}
        rowKey={(r) => `${r.type}-${r.id}`}
        empty="Aucun commerce abonné pour l'instant."
        columns={[
          { header: "Commerce", mobile: "title", cell: (r) => <span className="font-semibold">{r.name}</span> },
          { header: "Abonnement", mobile: "badge", align: "right", cell: (r) => <strong>{fcfa(r.monthlyFee)}</strong> },
          { header: "Type", cell: (r) => `${t(TYPE[r.type])}${r.plan ? ` · ${r.plan}` : ""}` },
          { header: "Téléphone", cell: (r) => r.phone },
        ]}
      />
    </div>
  );
}
