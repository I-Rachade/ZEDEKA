"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { card, input, primary, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, type DriverLease, type LeasePaymentRow } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { useDriver } from "../DriverShell";

const PAYMENT_STATUS: Record<LeasePaymentRow["status"], { label: string; tone: string }> = {
  PENDING: { label: "À confirmer", tone: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Confirmé", tone: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Refusé", tone: "bg-red-100 text-red-700" },
};
const METHOD: Record<LeasePaymentRow["method"], string> = { CASH: "Espèces", FLOOZ: "Flooz", TMONEY: "T-Money" };
const KIND: Record<string, string> = { HOME: "Moto rechargeable à la maison", ZEDEKA: "Moto Zedeka" };
const QUICK_DAYS = [1, 7, 30];

// « Ma moto » : la moto louée à Zedeka, l'état du leasing (payé jusqu'au…, ou en retard), le paiement par mobile
// money et l'historique. Les frais d'application (plan Zed, part des courses) restent à part.
export default function LeasePage() {
  const { reload: reloadCurrent } = useDriver();
  const { t, locale } = useI18n();
  const [state, setState] = useState<DriverLease | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(1);
  const [method, setMethod] = useState<"FLOOZ" | "TMONEY">("FLOOZ");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await driverFetch<DriverLease>("/lease"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const date = (key: string) => new Date(key.length === 10 ? `${key}T00:00:00Z` : key).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  if (!state)
    return (
      <div>
        <TopBar title="Ma moto" back="/livreur/profil" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );

  const { contract: c, balance: b } = state;
  if (!c || !b)
    return (
      <div>
        <TopBar title="Ma moto" back="/livreur/profil" />
        <div className="space-y-3 px-4 py-4">
          <section className={`${card} space-y-2 p-4`}>
            <h2 className="text-lg font-semibold">{t("Louez une moto Zedeka")}</h2>
            <p className="text-sm text-stone-700">
              {t("Zedeka loue ses motos aux livreurs et conducteurs indépendants, au jour : moto rechargeable à la maison ou moto Zedeka. Passez au bureau Zedeka pour signer votre contrat.")}
            </p>
          </section>
        </div>
      </div>
    );

  const late = b.state === "LATE";
  const ended = c.status === "ENDED";
  const amount = c.dailyRate * days;

  return (
    <div>
      <TopBar title="Ma moto" back="/livreur/profil" />
      <div className="space-y-4 px-4 py-4">
        <section className="flex items-center gap-3 rounded-[12px] bg-ink-deep p-4 text-white">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10">
            <Icon name="rider" className="h-7 w-7" />
          </span>
          <div className="flex-1">
            <p className="font-mono text-lg font-bold tracking-wide">{c.plate}</p>
            <p className="text-sm text-white/70">
              {t(KIND[c.kind] ?? c.kindLabel)}
              {c.label ? ` · ${c.label}` : ""}
            </p>
            <p className="text-sm text-white/70">{t("{amount} par jour, depuis le {date}", { amount: fcfa(c.dailyRate), date: date(c.startsAt) })}</p>
          </div>
        </section>

        <div className={`${card} flex items-center gap-3 p-4 ${late ? "border-2 border-red-300" : ""}`}>
          <Icon name={late ? "close" : b.state === "DUE_TODAY" ? "clock" : "check"} className={`h-8 w-8 shrink-0 ${late ? "text-red-600" : b.state === "DUE_TODAY" ? "text-amber-600" : "text-emerald-600"}`} />
          <div>
            <p className={`font-semibold ${late ? "text-red-700" : ""}`}>
              {late
                ? t("En retard de {n} jour(s)", { n: b.lateDays })
                : b.state === "DUE_TODAY"
                  ? t("Journée d'aujourd'hui à payer")
                  : ended
                    ? t("Contrat terminé, tout est payé")
                    : t("Leasing à jour")}
            </p>
            <p className="text-sm text-stone-600">{b.paidUntil ? t("Payé jusqu'au {date}", { date: date(b.paidUntil) }) : t("Aucun jour payé pour l'instant")}</p>
            {b.owed > 0 && <p className="text-sm font-semibold">{t("À payer : {amount}", { amount: fcfa(b.owed) })}</p>}
            {b.credit > 0 && <p className="text-sm text-emerald-700">{t("{amount} payés d'avance", { amount: fcfa(b.credit) })}</p>}
            {late && state.blockDays > 0 && (
              <p className="mt-1 text-sm text-red-700">{t("À {n} jour(s) de retard, vous ne pouvez plus vous mettre en ligne avant de payer.", { n: state.blockDays })}</p>
            )}
          </div>
        </div>
        {ended && <p className={`${card} p-4 text-sm text-stone-700`}>{t("Moto rendue le {date}.", { date: date(c.endedAt ?? c.startsAt) })}</p>}

        {!ended && (
          <form
            className={`${card} space-y-4 p-4`}
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const f = new FormData(form);
              setBusy(true);
              setError(null);
              try {
                setState(await driverFetch<DriverLease>("/lease/payments", { method: "POST", body: { days, method, reference: String(f.get("reference") ?? "") } }));
                form.reset();
                setSent(true);
                await reloadCurrent();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2 className="text-lg font-semibold">{t("Payer mon leasing")}</h2>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("Durée")}>
              {QUICK_DAYS.map((n) => (
                <button
                  type="button"
                  key={n}
                  role="radio"
                  aria-checked={days === n}
                  onClick={() => setDays(n)}
                  className={`rounded-2xl border-2 p-3 text-left ${days === n ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}
                >
                  <span className="block text-sm text-stone-600">{n === 1 ? t("1 jour") : t("{n} jours", { n })}</span>
                  <span className="block font-display text-lg font-extrabold">{fcfa(c.dailyRate * n)}</span>
                </button>
              ))}
            </div>
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-stone-600">{t("Nombre de jours")}</span>
              <input type="number" min={1} max={31} value={days} onChange={(e) => setDays(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} className={input} />
            </label>
            {b.owed > 0 && b.owed % c.dailyRate === 0 && b.owed / c.dailyRate <= 31 && days !== b.owed / c.dailyRate && (
              <button type="button" onClick={() => setDays(b.owed / c.dailyRate)} className="text-sm font-semibold text-emerald-700 underline">
                {t("Payer ce que je dois ({amount})", { amount: fcfa(b.owed) })}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Mobile money")}>
              {(["FLOOZ", "TMONEY"] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  role="radio"
                  aria-checked={method === m}
                  onClick={() => setMethod(m)}
                  className={`rounded-full border-2 px-3 py-2 font-semibold ${method === m ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-200"}`}
                >
                  {m === "FLOOZ" ? "Flooz" : "T-Money"}
                </button>
              ))}
            </div>
            <p className="rounded-xl bg-stone-100 p-3 text-sm">
              {state.paymentNumber
                ? t("Envoyez {amount} au {number}, puis saisissez la référence de la transaction.", { amount: fcfa(amount), number: state.paymentNumber })
                : t("Envoyez {amount} au numéro Zedeka, puis saisissez la référence de la transaction.", { amount: fcfa(amount) })}
            </p>
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-stone-600">{t("Référence de la transaction")}</span>
              <input name="reference" required minLength={4} maxLength={40} className={`${input} uppercase`} />
            </label>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {sent && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{t("Paiement envoyé : l'équipe le confirme sous peu.")}</p>}
            <button disabled={busy} className={primary}>
              {t("Envoyer la référence")}
            </button>
            <p className="text-xs text-stone-500">{t("Vous pouvez aussi payer en espèces au bureau Zedeka. Le leasing s'ajoute à vos frais d'application habituels.")}</p>
          </form>
        )}

        {state.payments.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("Mes paiements de leasing")}</h2>
            <ul className={`${card} divide-y divide-stone-100`}>
              {state.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {fcfa(p.amount)} · {t("{n} jour(s)", { n: p.days })}
                    </p>
                    <p className="text-stone-500">
                      {date(p.createdAt)} · {t(METHOD[p.method])}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </p>
                    {p.status === "REJECTED" && p.note && <p className="text-red-700">{p.note}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${PAYMENT_STATUS[p.status].tone}`}>{t(PAYMENT_STATUS[p.status].label)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
