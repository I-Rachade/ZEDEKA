"use client";

import { useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { FINANCE_STATUS, KIND_LABEL, METHOD_LABEL, type FinanceKind, type FinanceRequest, type FinanceStatus } from "@/lib/riderFinance";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, StatTile, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Summary = { toReview: number; atPartner: number; activePolicies: number; activeLoans: number; outstanding: number; openClaims: number };
type Row = FinanceRequest & {
  partnerRef: string | null;
  staffNote: string | null;
  updatedBy: string | null;
  next: FinanceStatus[];
  driver: { id: string; name: string; phone: string; employment: string };
};
type Tab = "ALL" | FinanceKind | "closed";

const STEP_LABEL: Record<FinanceStatus, string> = {
  REQUESTED: "Demandée",
  SENT: "Transmettre au partenaire",
  APPROVED: "Acceptée",
  REFUSED: "Refusée",
  ACTIVE: "Activer (contrat en cours)",
  CLOSED: "Clore",
  CANCELLED: "Annuler",
};

// Assurance et micro-crédit des livreurs : demandes reçues dans l'appli livreur, transmises à un partenaire (nom
// saisi), décision, contrat en cours, remboursements notés et clôture. Zedeka ne prête pas et n'assure pas elle-même.
export default function RiderFinanceAdminPage() {
  const [tab, setTab] = useState<Tab>("ALL");
  const { data: s, reload } = useAdmin<Summary>("/rider-finance/summary");
  const t = useI18n().t;
  const path = tab === "closed" ? "/rider-finance/requests?status=closed" : tab === "ALL" ? "/rider-finance/requests" : `/rider-finance/requests?kind=${tab}`;
  const { data, error, reload: reloadList } = useAdmin<Row[]>(path);
  const refresh = () => {
    reload();
    reloadList();
  };
  return (
    <div>
      <PageHeader
        icon="shield"
        title="Assurance et crédit"
        count={s?.toReview || undefined}
        description="Demandes d'assurance et de micro-crédit des livreurs, et sinistres déclarés. L'équipe transmet chaque demande à un partenaire (assureur, microfinance), note sa décision et suit le contrat : remboursements, sinistres, clôture."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="À traiter" value={s?.toReview ?? "–"} hint={s ? t("{n} chez un partenaire", { n: s.atPartner }) : undefined} icon="bell" />
        <StatTile label="Assurances en cours" value={s?.activePolicies ?? "–"} hint={s ? t("{n} sinistre(s) ouvert(s)", { n: s.openClaims }) : undefined} icon="shield" />
        <StatTile label="Crédits en cours" value={s?.activeLoans ?? "–"} icon="wallet" />
        <StatTile label="Reste à rembourser" value={s ? fcfa(s.outstanding) : "–"} icon="chart" />
      </div>
      <Card>
        <Tabs
          tabs={[
            { value: "ALL" as const, label: "En cours" },
            { value: "INSURANCE" as const, label: "Assurances" },
            { value: "LOAN" as const, label: "Crédits" },
            { value: "CLAIM" as const, label: "Sinistres", count: s?.openClaims },
            { value: "closed" as const, label: "Terminées" },
          ]}
          value={tab}
          onChange={setTab}
        />
        {!data ? (
          error ? <ErrorNote message={error} /> : <Loading />
        ) : data.length === 0 ? (
          <Empty>Aucune demande.</Empty>
        ) : (
          <ul className="space-y-2">
            {data.map((r) => (
              <RequestRow key={r.id} r={r} onChange={refresh} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RequestRow({ r, onChange }: { r: Row; onChange: () => void }) {
  const t = useI18n().t;
  const [open, setOpen] = useState<FinanceStatus | "EDIT" | "PAY" | null>(null);
  const [label, tone] = FINANCE_STATUS[r.status];
  const due = r.totalDue ?? r.approvedAmount;
  return (
    <li className="rounded-xl border border-stone-200 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-semibold">{t(KIND_LABEL[r.kind])}</span>
          <span className="font-semibold">{t(r.productLabel)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{t(label)}</span>
        </span>
        <span className="text-stone-500">{formatTime(r.createdAt)}</span>
      </div>
      <p className="mt-1">
        <span className="font-semibold">{r.driver.name}</span>{" "}
        <span className="text-stone-500">{r.driver.phone}</span>
      </p>
      <p className="text-stone-600">
        {r.kind === "LOAN" && r.amount !== null && t("Demande : {amount} sur {n} mois", { amount: fcfa(r.amount), n: r.months ?? 0 })}
        {r.kind === "CLAIM" && r.incidentAt && t("Survenu le {date}", { date: formatTime(r.incidentAt) })}
        {r.kind === "CLAIM" && r.amount !== null && ` · ${t("estimé {amount}", { amount: fcfa(r.amount) })}`}
      </p>
      {r.note && <p className="text-stone-700">« {r.note} »</p>}
      {(r.partner || r.approvedAmount !== null || r.installment !== null) && (
        <p className="text-stone-600">
          {[
            r.partner && `${r.partner}${r.partnerRef ? ` (${r.partnerRef})` : ""}`,
            r.approvedAmount !== null && t("accordé {amount}", { amount: fcfa(r.approvedAmount) }),
            r.totalDue !== null && t("total dû {amount}", { amount: fcfa(r.totalDue) }),
            r.installment !== null && (r.kind === "INSURANCE" ? t("prime {amount}/mois", { amount: fcfa(r.installment) }) : t("mensualité {amount}", { amount: fcfa(r.installment) })),
            r.endsAt && t("fin le {date}", { date: formatTime(r.endsAt) }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {r.kind === "LOAN" && due !== null && (
        <p className="font-semibold">
          {t("Remboursé {paid} sur {due}", { paid: fcfa(r.paid), due: fcfa(due) })}
          {r.remaining ? ` · ${t("reste {amount}", { amount: fcfa(r.remaining) })}` : ""}
        </p>
      )}
      {r.repayments.length > 0 && (
        <ul className="mt-1 text-stone-500">
          {r.repayments.slice(0, 5).map((p) => (
            <li key={p.id}>
              {formatTime(p.createdAt)} · {fcfa(p.amount)} · {t(METHOD_LABEL[p.method])}
              {p.reference ? ` · ${p.reference}` : ""}
              {p.recordedBy ? ` · ${p.recordedBy}` : ""}
            </li>
          ))}
        </ul>
      )}
      {(r.staffNote || r.updatedBy) && (
        <p className="text-stone-500">
          {r.staffNote}
          {r.staffNote && r.updatedBy ? " · " : ""}
          {r.updatedBy}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {r.next.map((s) => (
          <button key={s} type="button" onClick={() => setOpen(open === s ? null : s)} className={s === "CANCELLED" || s === "REFUSED" ? buttonGhost : button}>
            {t(STEP_LABEL[s])}
          </button>
        ))}
        {r.status === "ACTIVE" && r.kind !== "CLAIM" && (
          <button type="button" onClick={() => setOpen(open === "PAY" ? null : "PAY")} className={button}>
            {r.kind === "LOAN" ? t("Noter un remboursement") : t("Noter une prime payée")}
          </button>
        )}
        <button type="button" onClick={() => setOpen(open === "EDIT" ? null : "EDIT")} className={buttonGhost}>
          {t("Modifier")}
        </button>
      </div>
      {open === "PAY" && <PaymentForm r={r} onDone={() => {
            setOpen(null);
            onChange();
          }} />}
      {open && open !== "PAY" && <StatusForm r={r} to={open === "EDIT" ? r.status : open} onDone={() => {
            setOpen(null);
            onChange();
          }} />}
    </li>
  );
}

function StatusForm({ r, to, onDone }: { r: Row; to: FinanceStatus; onDone: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  const num = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : Number(v));
  const day = (v: FormDataEntryValue | null) => (v === null || String(v) === "" ? null : new Date(`${v}T12:00:00Z`).toISOString());
  const terms: FinanceStatus[] = ["APPROVED", "ACTIVE"];
  const showTerms = terms.includes(to) || (to === r.status && terms.includes(r.status));
  return (
    <form
      className="mt-2 grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body: Record<string, unknown> = { status: to, partner: String(f.get("partner") ?? ""), partnerRef: String(f.get("partnerRef") ?? ""), staffNote: String(f.get("staffNote") ?? "") };
        if (showTerms) {
          body.approvedAmount = num(f.get("approvedAmount"));
          if (r.kind === "LOAN") body.totalDue = num(f.get("totalDue"));
          if (r.kind !== "CLAIM") body.installment = num(f.get("installment"));
          body.startsAt = day(f.get("startsAt"));
          body.endsAt = day(f.get("endsAt"));
        }
        if (await action.run(() => adminFetch(`/rider-finance/requests/${r.id}/status`, { method: "POST", body }))) onDone();
      }}
    >
      <label className="block text-sm">
        {t("Partenaire")}
        <input name="partner" maxLength={80} required={to === "SENT"} defaultValue={r.partner ?? ""} placeholder={t("Assureur ou microfinance")} className={input} />
      </label>
      <label className="block text-sm">
        {t("Référence chez le partenaire")}
        <input name="partnerRef" maxLength={60} defaultValue={r.partnerRef ?? ""} className={input} />
      </label>
      {showTerms && (
        <>
          {r.kind !== "INSURANCE" && (
            <label className="block text-sm">
              {r.kind === "LOAN" ? t("Montant accordé (FCFA)") : t("Indemnité (FCFA)")}
              <input name="approvedAmount" type="number" min={0} defaultValue={r.approvedAmount ?? r.amount ?? ""} className={input} />
            </label>
          )}
          {r.kind === "LOAN" && (
            <label className="block text-sm">
              {t("Total à rembourser, intérêts compris (FCFA)")}
              <input name="totalDue" type="number" min={0} defaultValue={r.totalDue ?? ""} className={input} />
            </label>
          )}
          {r.kind !== "CLAIM" && (
            <label className="block text-sm">
              {r.kind === "LOAN" ? t("Mensualité (FCFA)") : t("Prime mensuelle (FCFA)")}
              <input name="installment" type="number" min={0} defaultValue={r.installment ?? ""} className={input} />
            </label>
          )}
          <label className="block text-sm">
            {t("Début")}
            <input name="startsAt" type="date" defaultValue={r.startsAt?.slice(0, 10) ?? ""} className={input} />
          </label>
          <label className="block text-sm">
            {t("Fin")}
            <input name="endsAt" type="date" defaultValue={r.endsAt?.slice(0, 10) ?? ""} className={input} />
          </label>
        </>
      )}
      <label className="block text-sm sm:col-span-2">
        {t("Note interne")}
        <input name="staffNote" maxLength={1000} defaultValue={r.staffNote ?? ""} className={input} />
      </label>
      <div className="sm:col-span-2">
        <ErrorNote message={action.error} />
        <button className={button}>{to === r.status ? t("Enregistrer") : t(STEP_LABEL[to])}</button>
        {to !== r.status && to !== "REQUESTED" && <p className="mt-1 text-xs text-stone-500">{t("Le livreur est prévenu dans son appli.")}</p>}
      </div>
    </form>
  );
}

function PaymentForm({ r, onDone }: { r: Row; onDone: () => void }) {
  const t = useI18n().t;
  const action = useAction();
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = { amount: Number(f.get("amount")) || 0, method: String(f.get("method")), reference: String(f.get("reference") ?? "") || undefined };
        if (await action.run(() => adminFetch(`/rider-finance/requests/${r.id}/payments`, { method: "POST", body }))) onDone();
      }}
    >
      <input name="amount" type="number" min={1} required defaultValue={r.installment ?? ""} aria-label={t("Montant")} placeholder={t("Montant")} className={`${input} w-36`} />
      <select name="method" defaultValue="CASH" aria-label={t("Moyen de paiement")} className={`${input} w-36`}>
        <option value="CASH">{t("Espèces")}</option>
        <option value="FLOOZ">Flooz</option>
        <option value="TMONEY">T-Money</option>
      </select>
      <input name="reference" maxLength={40} placeholder={t("Référence (mobile money)")} aria-label={t("Référence")} className={`${input} w-48`} />
      <button className={button}>{t("Enregistrer")}</button>
      <div className="w-full">
        <ErrorNote message={action.error} />
      </div>
    </form>
  );
}
