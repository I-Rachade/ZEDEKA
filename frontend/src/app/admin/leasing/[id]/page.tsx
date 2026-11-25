"use client";

import Link from "next/link";
import { use, useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, formatTime, roleOf, seesEverything, telLink, useStaff } from "@/lib/admin";
import { useI18n } from "@/lib/i18n/client";
import { button, buttonDanger, buttonGhost, Card, ErrorNote, input, Loading, PageHeader, StatTile } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";
import { day, KIND_LABEL, LeasePill, METHOD_LABEL, PAYMENT_STATUS, type LeaseContract, type LeasePayment } from "../shared";

type Detail = Omit<LeaseContract, "balance"> & { balance: LeaseContract["balance"]; payments: LeasePayment[] };

// Fiche d'un contrat de leasing : compte du livreur, paiements, espèces reçues au bureau, fin du contrat.
export default function LeaseContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const { data: c, error, reload } = useAdmin<Detail>(`/leases/${id}`);
  const action = useAction();
  const role = roleOf(useStaff());
  const manages = seesEverything(role);
  // Le comptable encaisse aussi les espèces au bureau (sans toucher au contrat).
  const collects = manages || role === "ACCOUNTANT";
  const [editing, setEditing] = useState(false);

  if (!c) return error ? <ErrorNote message={error} /> : <Loading />;
  const b = c.balance;
  const active = c.status === "ACTIVE";
  const run = (fn: () => Promise<unknown>) =>
    action.run(async () => {
      await fn();
      await reload();
    });

  return (
    <div className="space-y-4">
      <Link href="/admin/leasing" className="text-sm text-emerald-700 underline">
        ← {t("Leasing motos")}
      </Link>
      <PageHeader icon="rider" title={`${c.driver.name} · ${c.plate}`} description={KIND_LABEL[c.kind]} actions={<LeasePill balance={b} />} />
      <ErrorNote message={action.error} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Payé jusqu'au" value={b.paidUntil ? day(b.paidUntil, locale) : t("Rien payé")} icon="check" />
        <StatTile label="À payer" value={fcfa(b.owed)} hint={b.lateDays ? t("{n} jour(s) de retard", { n: b.lateDays }) : b.owed ? t("aujourd'hui") : undefined} icon="wallet" />
        <StatTile label="Total payé" value={fcfa(b.paid)} hint={t("{n} jour(s) couverts sur {due}", { n: b.paidDays, due: b.daysDue })} icon="chart" />
        <StatTile label="Prix par jour" value={fcfa(c.dailyRate)} hint={b.credit ? t("{amount} payés d'avance", { amount: fcfa(b.credit) }) : undefined} icon="rider" />
      </div>

      <Card title="Contrat">
        {!editing ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-stone-500">{t("Livreur")}</dt>
              <dd>
                <strong>{c.driver.name}</strong> ·{" "}
                <a href={telLink(c.driver.phone)} className="underline">
                  {c.driver.phone}
                </a>
                {c.driver.zedStatus === "ACTIVE" && <span className="ml-1 rounded-full bg-amber-100 px-2 text-xs font-semibold text-amber-800">Zed</span>}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">{t("Moto")}</dt>
              <dd>
                <span className="font-mono font-semibold">{c.plate}</span> · {t(KIND_LABEL[c.kind])}
                {c.label ? ` · ${c.label}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">{t("Début")}</dt>
              <dd>
                {day(c.startsAt, locale)}
                {c.createdBy ? ` · ${t("ouvert par {name}", { name: c.createdBy })}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-stone-500">{t("Caution")}</dt>
              <dd>{c.deposit != null ? fcfa(c.deposit) : t("Aucune")}</dd>
            </div>
            {c.endedAt && (
              <div>
                <dt className="text-stone-500">{t("Moto rendue le")}</dt>
                <dd>
                  {day(c.endedAt, locale)}
                  {c.endReason ? ` · ${c.endReason}` : ""}
                </dd>
              </div>
            )}
            {c.note && (
              <div className="sm:col-span-2">
                <dt className="text-stone-500">{t("Remarque")}</dt>
                <dd>{c.note}</dd>
              </div>
            )}
          </dl>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const deposit = String(f.get("deposit") ?? "").trim();
              const ok = await run(() =>
                adminFetch(`/leases/${c.id}`, {
                  method: "PATCH",
                  body: { plate: String(f.get("plate") ?? ""), label: String(f.get("label") ?? ""), note: String(f.get("note") ?? ""), deposit: deposit ? Number(deposit) : null },
                }),
              );
              if (ok) setEditing(false);
            }}
          >
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t("Plaque de la moto")}</span>
              <input name="plate" required minLength={3} maxLength={20} defaultValue={c.plate} className={`${input} uppercase`} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t("Modèle, couleur (facultatif)")}</span>
              <input name="label" maxLength={80} defaultValue={c.label ?? ""} className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t("Caution versée (FCFA, facultatif)")}</span>
              <input name="deposit" type="number" min={0} defaultValue={c.deposit ?? ""} className={input} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t("Remarque (facultatif)")}</span>
              <input name="note" maxLength={300} defaultValue={c.note ?? ""} className={input} />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button className={button}>{t("Enregistrer")}</button>
              <button type="button" onClick={() => setEditing(false)} className={buttonGhost}>
                {t("Annuler")}
              </button>
            </div>
          </form>
        )}
        {manages && !editing && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => setEditing(true)} className={buttonGhost}>
              {t("Modifier")}
            </button>
            {active && (
              <button
                onClick={() => {
                  const reason = window.prompt(t("La moto est rendue ? Raison de la fin du contrat (facultatif)"));
                  if (reason === null) return;
                  run(() => adminFetch(`/leases/${c.id}/end`, { method: "POST", body: { reason: reason.trim() || undefined } }));
                }}
                className={buttonDanger}
              >
                {t("Terminer le contrat (moto rendue)")}
              </button>
            )}
          </div>
        )}
      </Card>

      {collects && (
        <Card title="Espèces reçues au bureau">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              const ok = await run(() => adminFetch(`/leases/${c.id}/payments`, { method: "POST", body: { amount: Number(f.get("amount")), note: String(f.get("note") ?? "") || undefined } }));
              if (ok) form.reset();
            }}
          >
            <label className="block">
              <span className="mb-1 block text-sm font-medium">{t("Montant (FCFA)")}</span>
              <input name="amount" type="number" required min={1} step={1} placeholder={String(b.owed || c.dailyRate)} className={`${input} w-40!`} />
            </label>
            <label className="block flex-1">
              <span className="mb-1 block text-sm font-medium">{t("Remarque (facultatif)")}</span>
              <input name="note" maxLength={300} className={input} />
            </label>
            <button className={button}>{t("Encaisser")}</button>
          </form>
          {b.owed > 0 && <p className="mt-2 text-xs text-stone-500">{t("Pour être à jour aujourd'hui : {amount}.", { amount: fcfa(b.owed) })}</p>}
        </Card>
      )}

      <Card title={t("Paiements ({n})", { n: c.payments.length })}>
        {c.payments.length === 0 ? (
          <p className="text-sm text-stone-500">{t("Aucun paiement pour l'instant.")}</p>
        ) : (
          <ul className="divide-y divide-stone-100 text-sm">
            {c.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{fcfa(p.amount)}</strong> · {t("{n} jour(s)", { n: p.days })} · {t(METHOD_LABEL[p.method])}
                  {p.reference ? ` · ${p.reference}` : ""}
                  <span className="block text-xs text-stone-500">
                    {formatTime(p.createdAt)}
                    {p.reviewedBy ? ` · ${p.reviewedBy}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </span>
                </span>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${PAYMENT_STATUS[p.status].tone}`}>{t(PAYMENT_STATUS[p.status].label)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
