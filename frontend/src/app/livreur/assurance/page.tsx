"use client";

import { useCallback, useEffect, useState } from "react";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { FINANCE_STATUS, KIND_LABEL, METHOD_LABEL, type DriverFinance, type FinanceRequest } from "@/lib/riderFinance";

type Form = "INSURANCE" | "LOAN" | null;

// « Assurance et crédit » : demander une assurance (accident, moto, santé…) ou un micro-crédit, suivre la demande
// chez le partenaire de Zedeka, déclarer un sinistre et voir ses remboursements.
export default function RiderFinancePage() {
  const { t, locale } = useI18n();
  const [state, setState] = useState<DriverFinance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [claimFor, setClaimFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await driverFetch<DriverFinance>("/finance"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  if (!state)
    return (
      <div>
        <TopBar title="Assurance et crédit" back="/livreur/profil" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );

  const main = state.requests.filter((r) => r.kind !== "CLAIM");
  const claims = (id: string) => state.requests.filter((r) => r.kind === "CLAIM" && r.parentId === id);

  return (
    <div>
      <TopBar title="Assurance et crédit" back="/livreur/profil" />
      <div className="space-y-4 px-4 pb-10 pt-4">
        <section className={`${card} space-y-2 p-4`}>
          <h2 className="text-lg font-semibold">{t("Protégez-vous, financez votre activité")}</h2>
          <p className="text-sm text-stone-600">
            {t("Zedeka transmet votre demande à ses partenaires (assureurs, microfinance) et vous suit jusqu'au bout. La décision et les conditions sont celles du partenaire.")}
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => setForm(form === "INSURANCE" ? null : "INSURANCE")} className={form === "INSURANCE" ? primary : secondary}>
              {t("Une assurance")}
            </button>
            <button type="button" onClick={() => setForm(form === "LOAN" ? null : "LOAN")} className={form === "LOAN" ? primary : secondary}>
              {t("Un micro-crédit")}
            </button>
          </div>
        </section>

        {form && (
          <RequestForm
            kind={form}
            state={state}
            onDone={(next) => {
              setState(next);
              setForm(null);
            }}
          />
        )}

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {main.length === 0 ? (
          <p className={`${card} p-4 text-sm text-stone-600`}>{t("Aucune demande pour l'instant.")}</p>
        ) : (
          <ul className="space-y-3">
            {main.map((r) => (
              <li key={r.id} className={`${card} space-y-2 p-4`}>
                <RequestHead r={r} date={date} />
                {r.kind === "LOAN" && (r.status === "ACTIVE" || r.status === "CLOSED") && <LoanProgress r={r} date={date} />}
                {r.kind === "INSURANCE" && r.status === "ACTIVE" && (
                  <p className="text-sm text-stone-600">
                    {r.installment ? t("Prime : {amount} par mois", { amount: fcfa(r.installment) }) : null}
                    {r.endsAt ? ` · ${t("jusqu'au {date}", { date: date(r.endsAt) })}` : ""}
                  </p>
                )}
                {claims(r.id).map((c) => (
                  <div key={c.id} className="rounded-xl bg-stone-50 p-3">
                    <RequestHead r={c} date={date} />
                  </div>
                ))}
                {r.status === "REQUESTED" && (
                  <button
                    type="button"
                    className="text-sm font-semibold text-red-700"
                    onClick={async () => {
                      try {
                        setState(await driverFetch<DriverFinance>(`/finance/requests/${r.id}/cancel`, { method: "POST" }));
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    {t("Retirer la demande")}
                  </button>
                )}
                {r.kind === "INSURANCE" && r.status === "ACTIVE" && (
                  <>
                    <button type="button" className={secondary} onClick={() => setClaimFor(claimFor === r.id ? null : r.id)}>
                      {t("Déclarer un sinistre")}
                    </button>
                    {claimFor === r.id && (
                      <ClaimForm
                        policy={r}
                        state={state}
                        onDone={(next) => {
                          setState(next);
                          setClaimFor(null);
                        }}
                      />
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-stone-500">{t("Questions : appelez la répartition depuis votre profil.")}</p>
      </div>
    </div>
  );
}

function RequestHead({ r, date }: { r: FinanceRequest; date: (iso: string) => string }) {
  const { t } = useI18n();
  const [label, tone] = FINANCE_STATUS[r.status];
  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold uppercase tracking-wide text-stone-500">{t(KIND_LABEL[r.kind])}</span>
          <span className="block font-semibold">{t(r.productLabel)}</span>
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-semibold ${tone}`}>{t(label)}</span>
      </div>
      <p className="text-[13px] text-stone-500">
        {r.kind === "CLAIM" && r.incidentAt ? t("Survenu le {date}", { date: date(r.incidentAt) }) : t("Demandé le {date}", { date: date(r.createdAt) })}
        {r.amount !== null && r.kind === "LOAN" ? ` · ${t("{amount} sur {n} mois", { amount: fcfa(r.amount), n: r.months ?? 0 })}` : ""}
        {r.amount !== null && r.kind === "CLAIM" ? ` · ${fcfa(r.amount)}` : ""}
        {r.partner ? ` · ${r.partner}` : ""}
      </p>
      {r.approvedAmount !== null && r.status !== "REFUSED" && r.kind !== "INSURANCE" && (
        <p className="text-[13px] font-semibold text-emerald-700">
          {r.kind === "LOAN" ? t("Accordé : {amount}", { amount: fcfa(r.approvedAmount) }) : t("Indemnité : {amount}", { amount: fcfa(r.approvedAmount) })}
        </p>
      )}
      {r.note && <p className="text-[13px] text-stone-600">{r.note}</p>}
    </div>
  );
}

function LoanProgress({ r, date }: { r: FinanceRequest; date: (iso: string) => string }) {
  const { t } = useI18n();
  const due = r.totalDue ?? r.approvedAmount ?? 0;
  const pct = due ? Math.min(100, Math.round((r.paid / due) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div className="h-2 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm">
        {t("Remboursé : {paid} sur {due}", { paid: fcfa(r.paid), due: fcfa(due) })}
        {r.remaining ? ` · ${t("reste {amount}", { amount: fcfa(r.remaining) })}` : ""}
        {r.installment ? ` · ${t("{amount} par mois", { amount: fcfa(r.installment) })}` : ""}
      </p>
      {r.repayments.length > 0 && (
        <ul className="divide-y divide-stone-100 text-[13px]">
          {r.repayments.slice(0, 6).map((p) => (
            <li key={p.id} className="flex justify-between py-1">
              <span>
                {date(p.createdAt)} · {t(METHOD_LABEL[p.method])}
              </span>
              <span className="font-semibold">{fcfa(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RequestForm({ kind, state, onDone }: { kind: "INSURANCE" | "LOAN"; state: DriverFinance; onDone: (s: DriverFinance) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const products = Object.entries(state.products[kind]);
  return (
    <form
      className={`${card} space-y-3 p-4`}
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body =
          kind === "LOAN"
            ? { kind, product: String(f.get("product")), amount: Number(f.get("amount")) || 0, months: Number(f.get("months")) || 0, note: String(f.get("note") ?? "") }
            : { kind, product: String(f.get("product")), note: String(f.get("note") ?? "") || undefined };
        setBusy(true);
        setError(null);
        try {
          onDone(await driverFetch<DriverFinance>("/finance/requests", { method: "POST", body }));
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="font-semibold">{kind === "LOAN" ? t("Demander un micro-crédit") : t("Demander une assurance")}</h2>
      <fieldset className="space-y-2">
        <legend className="sr-only">{kind === "LOAN" ? t("Pour quoi ?") : t("Quelle assurance ?")}</legend>
        {products.map(([value, label], i) => (
          <label key={value} className="flex items-center gap-3 rounded-xl border border-stone-200 p-3 text-sm has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50">
            <input type="radio" name="product" value={value} defaultChecked={i === 0} />
            {t(label)}
          </label>
        ))}
      </fieldset>
      {kind === "LOAN" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            {t("Montant (FCFA)")}
            <input name="amount" type="number" required min={state.loan.min} max={state.loan.max} step={1000} className={input} />
          </label>
          <label className="block text-sm">
            {t("Durée (mois)")}
            <input name="months" type="number" required min={1} max={state.loan.maxMonths} defaultValue={6} className={input} />
          </label>
        </div>
      )}
      <textarea
        name="note"
        required={kind === "LOAN"}
        minLength={kind === "LOAN" ? 5 : undefined}
        maxLength={500}
        rows={3}
        placeholder={kind === "LOAN" ? t("À quoi servira le crédit ?") : t("Précisions (facultatif)")}
        aria-label={t("Précisions")}
        className={input}
      />
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className={primary}>
        {t("Envoyer la demande")}
      </button>
    </form>
  );
}

function ClaimForm({ policy, state, onDone }: { policy: FinanceRequest; state: DriverFinance; onDone: (s: DriverFinance) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2 rounded-xl border border-stone-200 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const day = String(f.get("incidentAt") ?? "");
        const amount = String(f.get("amount") ?? "").trim();
        setBusy(true);
        setError(null);
        try {
          onDone(
            await driverFetch<DriverFinance>(`/finance/requests/${policy.id}/claims`, {
              method: "POST",
              body: { product: String(f.get("product")), incidentAt: new Date(`${day}T12:00:00Z`).toISOString(), amount: amount ? Number(amount) : undefined, note: String(f.get("note") ?? "") },
            }),
          );
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <select name="product" aria-label={t("Type de sinistre")} className={input}>
        {Object.entries(state.products.CLAIM).map(([value, label]) => (
          <option key={value} value={value}>
            {t(label)}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm">
          {t("Date")}
          <input name="incidentAt" type="date" required max={new Date().toISOString().slice(0, 10)} className={input} />
        </label>
        <label className="block text-sm">
          {t("Montant estimé (FCFA)")}
          <input name="amount" type="number" min={0} className={input} />
        </label>
      </div>
      <textarea name="note" required minLength={5} maxLength={1000} rows={3} placeholder={t("Que s'est-il passé ?")} aria-label={t("Que s'est-il passé ?")} className={input} />
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <button disabled={busy} className={primary}>
        {t("Déclarer le sinistre")}
      </button>
    </form>
  );
}
