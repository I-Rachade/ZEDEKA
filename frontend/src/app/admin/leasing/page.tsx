"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, roleOf, seesEverything, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";
import { day, KIND_LABEL, LeasePill, METHOD_LABEL, type LeaseContract, type LeaseKind, type LeasePayment } from "./shared";

type Summary = {
  active: number;
  home: number;
  zedeka: number;
  late: number;
  owed: number;
  pendingPayments: number;
  perDay: number;
  collectedThisMonth: number;
  rates: Record<LeaseKind, number>;
  blockDays: number;
};
type PendingPayment = LeasePayment & {
  driver: { id: string; name: string; phone: string };
  contract: { id: string; plate: string; kind: LeaseKind; dailyRate: number };
};
type Candidate = { id: string; name: string; phone: string; plate: string | null; zedStatus: string | null; deliveries: boolean };

type Tab = "contrats" | "paiements" | "nouveau" | "termines";

export default function LeasingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Leasing />
    </Suspense>
  );
}

// Leasing de motos aux livreurs et conducteurs indépendants : contrats en cours, paiements à confirmer, nouveau contrat.
function Leasing() {
  const params = useSearchParams();
  const preselected = params.get("livreur");
  const [tab, setTab] = useState<Tab>(preselected ? "nouveau" : ((params.get("onglet") as Tab | null) ?? "contrats"));
  const { data: s, reload } = useAdmin<Summary>("/leases/summary");
  const manages = seesEverything(roleOf(useStaff()));
  const t = useI18n().t;

  return (
    <div>
      <PageHeader
        icon="rider"
        title="Leasing motos"
        count={s?.pendingPayments || undefined}
        description="Motos de Zedeka louées aux livreurs et conducteurs indépendants, au jour. Le livreur paie son leasing en plus de ses frais d'application, par mobile money (à confirmer ici) ou en espèces au bureau."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Motos louées" value={s?.active ?? "–"} hint={s ? t("{home} rechargeable(s) · {zedeka} Zedeka", { home: s.home, zedeka: s.zedeka }) : undefined} icon="rider" />
        <StatTile label="En retard" value={s?.late ?? "–"} hint={s ? t("{amount} à encaisser", { amount: fcfa(s.owed) }) : undefined} icon="clock" />
        <StatTile label="Paiements à confirmer" value={s?.pendingPayments ?? "–"} icon="wallet" />
        <StatTile label="Encaissé ce mois-ci" value={s ? fcfa(s.collectedThisMonth) : "–"} hint={s ? t("{amount} attendus par jour", { amount: fcfa(s.perDay) }) : undefined} icon="chart" />
      </div>
      <Card>
        <Tabs
          tabs={[
            { value: "contrats" as const, label: "Contrats en cours", count: s?.active },
            { value: "paiements" as const, label: "Paiements à confirmer", count: s?.pendingPayments },
            ...(manages ? [{ value: "nouveau" as const, label: "Nouveau contrat" }] : []),
            { value: "termines" as const, label: "Terminés" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab === "contrats" && <Contracts status="ACTIVE" />}
        {tab === "termines" && <Contracts status="ENDED" />}
        {tab === "paiements" && <Payments onChange={reload} />}
        {tab === "nouveau" && s && <NewContract rates={s.rates} preselected={preselected} />}
      </Card>
      {s && (
        <p className="mt-3 text-xs text-stone-500">
          <Link href="/admin/reglages#leasing" className="underline">
            {s.blockDays > 0 ? t("Mise en ligne bloquée après {n} jour(s) de retard", { n: s.blockDays }) : t("Pas de blocage en cas de retard")}
          </Link>
        </p>
      )}
    </div>
  );
}

function Contracts({ status }: { status: "ACTIVE" | "ENDED" }) {
  const { t, locale } = useI18n();
  const { data, error } = useAdmin<LeaseContract[]>(`/leases?status=${status}`);
  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <DataTable
      rows={data}
      rowKey={(c) => c.id}
      rowHref={(c) => `/admin/leasing/${c.id}`}
      empty={status === "ACTIVE" ? "Aucune moto en leasing pour l'instant." : "Aucun contrat terminé."}
      columns={[
        {
          header: "Livreur",
          mobile: "title",
          cell: (c) => (
            <span>
              <span className="font-semibold">{c.driver.name}</span>
              <span className="block text-xs text-stone-500">{c.driver.phone}</span>
            </span>
          ),
        },
        { header: "État", mobile: "badge", cell: (c) => <LeasePill balance={c.balance} /> },
        {
          header: "Moto",
          cell: (c) => (
            <span>
              <span className="font-mono font-semibold">{c.plate}</span>
              <span className="block text-xs text-stone-500">{t(KIND_LABEL[c.kind])}</span>
            </span>
          ),
        },
        { header: "Prix par jour", cell: (c) => fcfa(c.dailyRate) },
        { header: "Payé jusqu'au", cell: (c) => (c.balance.paidUntil ? day(c.balance.paidUntil, locale) : <span className="text-stone-500">{t("Rien payé")}</span>) },
        { header: "À payer", cell: (c) => (c.balance.owed ? <span className="font-semibold text-red-700">{fcfa(c.balance.owed)}</span> : "–") },
        status === "ACTIVE" ? { header: "Depuis le", cell: (c) => day(c.startsAt, locale) } : { header: "Rendue le", cell: (c) => (c.endedAt ? day(c.endedAt, locale) : "–") },
      ]}
    />
  );
}

function Payments({ onChange }: { onChange: () => void }) {
  const t = useI18n().t;
  const { data, error, reload } = useAdmin<PendingPayment[]>("/lease-payments?status=PENDING");
  const action = useAction();
  const [busy, setBusy] = useState<string | null>(null);

  async function review(p: PendingPayment, decision: "CONFIRM" | "REJECT") {
    const note = decision === "REJECT" ? (window.prompt(t("Raison du refus (envoyée au livreur)")) ?? undefined) : undefined;
    if (decision === "REJECT" && note === undefined) return;
    setBusy(p.id);
    await action.run(() => adminFetch(`/lease-payments/${p.id}/review`, { method: "POST", body: { decision, note } }));
    setBusy(null);
    reload();
    onChange();
  }

  if (!data) return error ? <ErrorNote message={error} /> : <Loading />;
  return (
    <>
      <ErrorNote message={action.error} />
      <DataTable
        rows={data}
        rowKey={(p) => p.id}
        empty="Aucun paiement à confirmer."
        columns={[
          {
            header: "Livreur",
            mobile: "title",
            cell: (p) => (
              <span>
                <span className="font-semibold">{p.driver.name}</span>
                <span className="block text-xs text-stone-500">
                  {p.driver.phone} · {p.contract.plate}
                </span>
              </span>
            ),
          },
          { header: "Jours", cell: (p) => t("{n} jour(s)", { n: p.days }) },
          { header: "Montant", mobile: "badge", cell: (p) => <span className="font-semibold">{fcfa(p.amount)}</span> },
          { header: "Référence", cell: (p) => `${METHOD_LABEL[p.method]} · ${p.reference ?? ""}` },
          { header: "Envoyé le", cell: (p) => formatTime(p.createdAt) },
          {
            header: "",
            cell: (p) => (
              <span className="flex gap-2">
                <button disabled={busy === p.id} onClick={() => review(p, "CONFIRM")} className={button}>
                  {t("Confirmer")}
                </button>
                <button disabled={busy === p.id} onClick={() => review(p, "REJECT")} className={buttonGhost}>
                  {t("Refuser")}
                </button>
              </span>
            ),
          },
        ]}
      />
    </>
  );
}

function NewContract({ rates, preselected }: { rates: Record<LeaseKind, number>; preselected: string | null }) {
  const t = useI18n().t;
  const router = useRouter();
  const { data: drivers, error } = useAdmin<Candidate[]>("/leases/drivers");
  const action = useAction();
  const [kind, setKind] = useState<LeaseKind>("HOME");
  const [driverId, setDriverId] = useState(preselected ?? "");
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (!drivers) return error ? <ErrorNote message={error} /> : <Loading />;
  const chosen = drivers.find((d) => d.id === driverId);

  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const num = (k: string) => (String(f.get(k) ?? "").trim() ? Number(f.get(k)) : undefined);
        setBusy(true);
        let id: string | null = null;
        await action.run(async () => {
          const c = await adminFetch<{ id: string }>("/leases", {
            method: "POST",
            body: {
              driverId,
              kind,
              plate: String(f.get("plate") ?? ""),
              label: String(f.get("label") ?? "") || null,
              startsAt: String(f.get("startsAt") ?? "") || undefined,
              dailyRate: num("dailyRate"),
              deposit: num("deposit") ?? null,
              note: String(f.get("note") ?? "") || null,
            },
          });
          id = c.id;
        });
        setBusy(false);
        if (id) router.push(`/admin/leasing/${id}`);
      }}
    >
      <p className="text-sm text-stone-600">{t("Seuls les livreurs et conducteurs Zedeka validés et indépendants peuvent louer une moto, une à la fois.")}</p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("Livreur")}</span>
        <select required value={driverId} onChange={(e) => setDriverId(e.target.value)} className={input}>
          <option value="">{t("Choisir un livreur…")}</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.phone}
              {d.zedStatus === "ACTIVE" ? (d.deliveries ? ` · ${t("Livreur et Zed")}` : ` · ${t("Zed seulement")}`) : ""}
            </option>
          ))}
        </select>
        {preselected && !chosen && <span className="mt-1 block text-sm text-amber-800">{t("Ce livreur ne peut pas louer de moto pour l'instant (salarié, non validé ou déjà en leasing).")}</span>}
      </label>
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Type de moto")}>
        {(["HOME", "ZEDEKA"] as const).map((k) => (
          <button
            type="button"
            key={k}
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`rounded-xl border-2 p-3 text-left ${kind === k ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}
          >
            <span className="block text-sm font-semibold">{t(KIND_LABEL[k])}</span>
            <span className="block text-sm text-stone-600">{t("{amount} par jour", { amount: fcfa(rates[k]) })}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("Plaque de la moto")}</span>
          <input name="plate" required minLength={3} maxLength={20} placeholder="TG 1234 AB" defaultValue={chosen?.plate ?? ""} key={chosen?.id ?? "none"} className={`${input} uppercase`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("Modèle, couleur (facultatif)")}</span>
          <input name="label" maxLength={80} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("Début du contrat")}</span>
          <input name="startsAt" type="date" defaultValue={today} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("Prix par jour (FCFA)")}</span>
          <input name="dailyRate" type="number" min={0} max={100000} placeholder={String(rates[kind])} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("Caution versée (FCFA, facultatif)")}</span>
          <input name="deposit" type="number" min={0} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("Remarque (facultatif)")}</span>
          <input name="note" maxLength={300} className={input} />
        </label>
      </div>
      <p className="text-xs text-stone-500">{t("Le prix par jour est celui des réglages si vous le laissez vide. Il reste fixe pour toute la durée du contrat.")}</p>
      <ErrorNote message={action.error} />
      <button disabled={busy || !driverId} className={button}>
        {busy ? t("Enregistrement…") : t("Ouvrir le contrat")}
      </button>
    </form>
  );
}
