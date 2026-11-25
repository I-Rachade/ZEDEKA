"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { card, input, primary, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, type ZedPayment, type ZedState } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { useDriver } from "../DriverShell";

const PAYMENT_STATUS: Record<ZedPayment["status"], { label: string; tone: string }> = {
  PENDING: { label: "À confirmer", tone: "bg-amber-100 text-amber-800" },
  CONFIRMED: { label: "Confirmé", tone: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Refusé", tone: "bg-red-100 text-red-700" },
};
const PLAN_LABEL: Record<ZedPayment["plan"], string> = {
  TRIAL: "Mois offert",
  MONTH: "Mois",
  DAY: "Jour",
};

// Mode Zed du conducteur : état du dossier, inscription d'un livreur indépendant, plan (mois ou jour) payé par mobile money.
export default function ZedPage() {
  const { reload: reloadCurrent } = useDriver();
  const { t, locale } = useI18n();
  const [state, setState] = useState<ZedState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<"MONTH" | "DAY">("MONTH");
  const [days, setDays] = useState(1);
  const [method, setMethod] = useState<"FLOOZ" | "TMONEY">("FLOOZ");
  const [sent, setSent] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await driverFetch<ZedState>("/zed"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function run(action: () => Promise<ZedState>) {
    setBusy(true);
    setError(null);
    try {
      setState(await action());
      await reloadCurrent();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: "numeric",
      month: "long",
      timeZone: "Africa/Lome",
    });

  if (!state)
    return (
      <div>
        <TopBar title="Mode Zed" back="/livreur" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );

  const amount = plan === "MONTH" ? state.prices.month : state.prices.day * days;

  return (
    <div>
      <TopBar title="Mode Zed" back="/livreur" />
      <div className="space-y-4 px-4 py-4">
        <section className="flex items-center gap-3 rounded-[12px] bg-ink-deep p-4 text-white">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-sun font-display text-lg font-extrabold text-ink-deep">Zed</span>
          <div className="flex-1">
            <p className="font-bold">{t("Conducteur Zed")}</p>
            <p className="text-sm text-white/70">{t("Les clients à moins de 1 km vous appellent. Le prix se fait sur place.")}</p>
          </div>
        </section>

        {state.status === null && state.canApply && (
          <form
            className={`${card} space-y-4 p-4`}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(() =>
                driverFetch<ZedState>("/zed/apply", {
                  method: "POST",
                  body: {
                    plate: String(f.get("plate") ?? ""),
                    acceptTerms: f.get("terms") === "on",
                  },
                }),
              );
            }}
          >
            <div>
              <h2 className="text-lg font-semibold">{t("Faire aussi du Zed")}</h2>
              <p className="text-sm text-stone-600">{t("Gardez vos livraisons et recevez aussi les appels Zed. L'équipe vérifie votre dossier, puis le premier mois est offert.")}</p>
            </div>
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-stone-600">{t("Plaque de la moto")}</span>
              <input name="plate" required minLength={3} maxLength={20} placeholder="TG 1234 AB" className={`${input} uppercase`} defaultValue={state.plate ?? ""} />
            </label>
            <p className="rounded-xl bg-stone-50 p-3 text-sm text-stone-700">{t("Apportez votre pièce d'identité à l'équipe Zedeka : elle prend votre photo et l'ajoute à votre dossier.")}</p>
            <label className="flex items-start gap-2 text-sm">
              <input name="terms" type="checkbox" required className="mt-1 h-4 w-4 accent-emerald-600" />
              <span>{t("J'accepte les conditions des conducteurs Zed.")}</span>
            </label>
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button disabled={busy} className={primary}>
              {busy ? t("Envoi du dossier…") : t("Envoyer mon dossier")}
            </button>
          </form>
        )}

        {state.status === null && !state.canApply && <p className={`${card} p-4 text-sm text-stone-700`}>{t("Le mode Zed est réservé aux livreurs indépendants.")}</p>}

        {state.status === "PENDING" && (
          <div className={`${card} space-y-2 p-4`}>
            <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">
              <Icon name="clock" className="h-4 w-4" />
              {t("Dossier Zed en cours de vérification")}
            </span>
            <p className="text-sm text-stone-700">{t("Passez au bureau Zedeka avec votre pièce d'identité : l'équipe prend votre photo et valide votre dossier. Le mode Zed s'ouvrira avec le premier mois offert.")}</p>
          </div>
        )}

        {(state.status === "REJECTED" || state.status === "SUSPENDED") && (
          <div className={`${card} space-y-2 p-4`}>
            <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
              <Icon name="close" className="h-4 w-4" />
              {state.status === "REJECTED" ? t("Dossier Zed non retenu") : t("Mode Zed suspendu")}
            </span>
            {state.note && <p className="text-sm text-stone-700">{state.note}</p>}
            <p className="text-sm text-stone-500">{t("Pour en savoir plus, contactez l'équipe Zedeka.")}</p>
          </div>
        )}

        {state.status === "ACTIVE" && (
          <>
            <div className={`${card} flex items-center gap-3 p-4`}>
              <Icon name={state.plan ? "check" : "close"} className={`h-8 w-8 shrink-0 ${state.plan ? "text-emerald-600" : "text-red-600"}`} />
              <div>
                <p className="font-semibold">{state.plan ? t("Plan Zed actif") : t("Plan Zed expiré")}</p>
                <p className="text-sm text-stone-600">
                  {state.plan ? t("Jusqu'au {date}", { date: date(state.plan.endsAt) }) : t("Payez votre plan pour recevoir à nouveau les appels.")}
                </p>
                {state.plate && <p className="text-sm text-stone-500">{t("Plaque : {plate}", { plate: state.plate })}</p>}
              </div>
            </div>

            <form
              className={`${card} space-y-4 p-4`}
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                const ok = await run(() =>
                  driverFetch<ZedState>("/zed/payments", {
                    method: "POST",
                    body: {
                      plan,
                      days: plan === "DAY" ? days : undefined,
                      method,
                      reference: String(f.get("reference") ?? ""),
                    },
                  }),
                );
                if (ok) {
                  form.reset();
                  setSent(true);
                }
              }}
            >
              <h2 className="text-lg font-semibold">{t("Payer mon plan Zed")}</h2>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Plan")}>
                {(["MONTH", "DAY"] as const).map((p) => (
                  <button
                    type="button"
                    key={p}
                    role="radio"
                    aria-checked={plan === p}
                    onClick={() => setPlan(p)}
                    className={`rounded-2xl border-2 p-3 text-left ${plan === p ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}
                  >
                    <span className="block text-sm text-stone-600">{p === "MONTH" ? t("30 jours") : t("Par jour")}</span>
                    <span className="block font-display text-xl font-extrabold">{fcfa(p === "MONTH" ? state.prices.month : state.prices.day)}</span>
                  </button>
                ))}
              </div>
              {plan === "DAY" && (
                <label className="block">
                  <span className="mb-2 block text-[13px] font-medium text-stone-600">{t("Nombre de jours")}</span>
                  <input type="number" min={1} max={31} value={days} onChange={(e) => setDays(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} className={input} />
                </label>
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
                {state.prices.paymentNumber
                  ? t("Envoyez {amount} au {number}, puis saisissez la référence de la transaction.", {
                      amount: fcfa(amount),
                      number: state.prices.paymentNumber,
                    })
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
            </form>
          </>
        )}

        {state.payments.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("Mes paiements")}</h2>
            <ul className={`${card} divide-y divide-stone-100`}>
              {state.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {t(PLAN_LABEL[p.plan])}
                      {p.plan === "DAY" && p.days > 1 ? ` × ${p.days}` : ""} · {p.amount ? fcfa(p.amount) : t("Offert")}
                    </p>
                    <p className="text-stone-500">
                      {p.startsAt && p.endsAt
                        ? t("Du {from} au {to}", {
                            from: date(p.startsAt),
                            to: date(p.endsAt),
                          })
                        : `${p.method === "FLOOZ" ? "Flooz" : "T-Money"} · ${p.reference ?? ""}`}
                    </p>
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
