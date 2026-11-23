"use client";

import dynamic from "next/dynamic";
import { use, useCallback, useEffect, useState } from "react";
import { CustomerPushPrompt } from "@/components/CustomerPush";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { customerFetch } from "@/lib/customer";
import { tel } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import {
  ABSENCE_LEG,
  dayLabel,
  hhmm,
  KIND_LABEL,
  LEG_LABEL,
  monthLabel,
  PASS_STATUS,
  scheduleText,
  TRIP_STATUS,
  type Leg,
  type MonthState,
  type PassKind,
  type PassStatus,
  type Schedule,
  type SchoolTrip,
} from "@/lib/school";
import { card, input, primary, secondary, Skeleton, TopBar } from "../../ui";

const PointPreview = dynamic(() => import("@/components/PointPreview"), { ssr: false });

type Detail = {
  id: string;
  kind: PassKind;
  riderName: string;
  riderGrade: string | null;
  schoolName: string;
  schoolAddress: string;
  homeAddress: string;
  homeLatitude: number | null;
  homeLongitude: number | null;
  schedule: Schedule;
  emergencyName: string;
  emergencyPhone: string;
  emergency2Name: string | null;
  emergency2Phone: string | null;
  healthNote: string | null;
  note: string | null;
  homeCode: string | null;
  schoolCode: string | null;
  monthlyFee: number;
  status: PassStatus;
  statusNote: string | null;
  startsOn: string | null;
  driver: { id: string; name: string; phone: string; plate: string | null; vehicle: string; position: { latitude: number; longitude: number; at: string } | null } | null;
  trips: (SchoolTrip & { date: string })[];
  absences: { id: string; date: string; leg: "BOTH" | Leg; reason: string | null }[];
  payments: { id: string; month: string; amount: number; method: string; createdAt: string }[];
  month: MonthState;
  today: string;
};

const LIVE_MS = 10_000;

// Fiche d'un abonnement : trajets du jour suivis en direct, codes de remise, absences, paiements.
export default function SchoolPassPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, locale } = useI18n();
  const [pass, setPass] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPass(await customerFetch<Detail>(`/school/passes/${id}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const today = pass?.trips.filter((tr) => tr.date === pass.today).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)) ?? [];
  const live = today.some((tr) => tr.status === "ON_THE_WAY" || tr.status === "PICKED_UP");
  // Trajet en cours : la fiche se met à jour toute seule (position du conducteur, étapes).
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(load, LIVE_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  if (!pass)
    return (
      <div>
        <TopBar title="Transport scolaire" back="/app/ecole" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={4} />}</div>
      </div>
    );

  const child = pass.kind === "SCHOOL";
  const home = pass.homeLatitude !== null && pass.homeLongitude !== null ? { latitude: pass.homeLatitude, longitude: pass.homeLongitude } : null;
  const history = pass.trips.filter((tr) => tr.date !== pass.today && tr.status !== "PLANNED").slice(0, 10);

  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (done) setNotice(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <TopBar title={pass.riderName} back="/app/ecole" />
      <div className="space-y-4 p-4">
        <section className="flex items-center gap-3 rounded-[12px] bg-ink-deep p-4 text-white">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10 text-2xl" aria-hidden="true">
            {child ? "🎒" : "🎓"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold">{pass.riderName}</p>
            <p className="truncate text-sm text-white/70">
              {t(KIND_LABEL[pass.kind])}
              {pass.riderGrade ? ` · ${pass.riderGrade}` : ""} · {pass.schoolName}
            </p>
            <p className="text-sm text-white/70">{scheduleText(pass.schedule, t)}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${PASS_STATUS[pass.status].tone}`}>{t(PASS_STATUS[pass.status].label)}</span>
        </section>

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        {pass.statusNote && pass.status !== "ACTIVE" && <p className={`${card} p-4 text-sm text-stone-700`}>{pass.statusNote}</p>}

        {pass.status === "PENDING" && (
          <section className={`${card} space-y-3 p-4`}>
            <p className="font-semibold">{t("Demande envoyée")}</p>
            <p className="text-sm text-stone-700">
              {t("L'équipe Zedeka choisit un conducteur attitré vérifié près de chez vous et vous appelle pour confirmer. Vous recevrez une notification à la validation.")}
            </p>
            <button disabled={busy} onClick={() => act(() => customerFetch(`/school/passes/${pass.id}/cancel`, { method: "POST" }), t("Demande retirée."))} className={secondary}>
              {t("Retirer la demande")}
            </button>
          </section>
        )}

        {pass.status === "ACTIVE" && !pass.month.paid && (
          <section className={`${card} space-y-1 border-2 p-4 ${pass.month.suspended ? "border-red-300" : "border-amber-300"}`}>
            <p className={`font-semibold ${pass.month.suspended ? "text-red-700" : "text-amber-800"}`}>
              {pass.month.suspended ? t("Trajets arrêtés : {month} n'est pas payé", { month: monthLabel(pass.month.month, locale) }) : t("{month} à payer", { month: monthLabel(pass.month.month, locale) })}
            </p>
            <p className="text-sm text-stone-700">
              {t("{amount} à régler au bureau Zedeka (espèces ou virement).", { amount: fcfa(pass.month.amount) })}{" "}
              {!pass.month.suspended && t("Les trajets continuent jusqu'au {n} du mois.", { n: pass.month.graceDays })}
            </p>
          </section>
        )}

        {pass.driver && (
          <section className={`${card} space-y-3 p-4`}>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-100 font-bold text-emerald-700">{pass.driver.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-stone-500">{t("Conducteur attitré")}</p>
                <p className="font-semibold">{pass.driver.name}</p>
                {pass.driver.plate && <p className="font-mono text-sm">{pass.driver.plate}</p>}
              </div>
              <a href={tel(pass.driver.phone)} className="grid h-11 w-11 place-items-center rounded-full bg-emerald-600 text-white" aria-label={t("Appeler le conducteur")}>
                <Icon name="phone" className="h-5 w-5" />
              </a>
            </div>
            {pass.driver.position && (
              <div>
                <PointPreview point={pass.driver.position} pickup={home} />
                <p className="mt-1 text-xs text-stone-500">{t("Position du conducteur à {time}, mise à jour toutes les 10 secondes.", { time: hhmm(pass.driver.position.at) })}</p>
              </div>
            )}
          </section>
        )}

        {pass.status === "ACTIVE" && (
          <section className={`${card} p-4`}>
            <h2 className="mb-2 font-semibold">{t("Aujourd'hui")}</h2>
            {today.length === 0 ? (
              <p className="text-sm text-stone-600">{t("Pas de trajet aujourd'hui.")}</p>
            ) : (
              <ol className="space-y-2">
                {today.map((tr) => (
                  <TripLine key={tr.id} trip={tr} />
                ))}
              </ol>
            )}
          </section>
        )}
        {(live || pass.status === "ACTIVE") && <CustomerPushPrompt />}

        {child && pass.homeCode && pass.schoolCode && (pass.status === "ACTIVE" || pass.status === "PAUSED" || pass.status === "PENDING") && (
          <section className={`${card} space-y-3 p-4`}>
            <h2 className="font-semibold">{t("Codes de remise")}</h2>
            <p className="text-sm text-stone-700">{t("Le conducteur ne remet votre enfant qu'avec le bon code. Il ne connaît pas ces codes : c'est la personne qui reçoit l'enfant qui les lui donne.")}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-stone-100 p-3 text-center">
                <p className="text-xs text-stone-600">{t("Code de l'école")}</p>
                <p className="font-mono text-3xl font-bold tracking-[0.3em]">{pass.schoolCode}</p>
                <p className="text-xs text-stone-500">{t("À donner à l'école (maîtresse, gardien)")}</p>
              </div>
              <div className="rounded-xl bg-stone-100 p-3 text-center">
                <p className="text-xs text-stone-600">{t("Code de la maison")}</p>
                <p className="font-mono text-3xl font-bold tracking-[0.3em]">{pass.homeCode}</p>
                <p className="text-xs text-stone-500">{t("Pour vous ou l'adulte qui accueille l'enfant")}</p>
              </div>
            </div>
            <button
              disabled={busy}
              onClick={() => {
                if (window.confirm(t("Créer de nouveaux codes ? Les anciens ne marcheront plus : redonnez le nouveau code à l'école.")))
                  act(() => customerFetch(`/school/passes/${pass.id}/codes`, { method: "POST" }), t("Nouveaux codes créés."));
              }}
              className="text-sm text-emerald-700 underline"
            >
              {t("Changer les codes")}
            </button>
          </section>
        )}

        {(pass.status === "ACTIVE" || pass.status === "PAUSED") && <Absences pass={pass} busy={busy} act={act} />}

        <section className={`${card} space-y-2 p-4 text-sm`}>
          <h2 className="font-semibold">{t("Adresses et contacts")}</h2>
          <p>
            <span className="text-stone-500">{t("Maison")} : </span>
            {pass.homeAddress}
          </p>
          <p>
            <span className="text-stone-500">{t("École")} : </span>
            {pass.schoolName}, {pass.schoolAddress}
          </p>
          <p>
            <span className="text-stone-500">{t("Urgence")} : </span>
            {pass.emergencyName}, {pass.emergencyPhone}
            {pass.emergency2Name ? ` · ${pass.emergency2Name}${pass.emergency2Phone ? `, ${pass.emergency2Phone}` : ""}` : ""}
          </p>
          {pass.healthNote && (
            <p>
              <span className="text-stone-500">{t("Santé")} : </span>
              {pass.healthNote}
            </p>
          )}
          <p className="text-xs text-stone-500">{t("Visible seulement par vous, le conducteur attitré et l'équipe Zedeka. Pour changer d'adresse ou d'horaires, appelez Zedeka.")}</p>
        </section>

        <section className={`${card} space-y-2 p-4`}>
          <h2 className="font-semibold">{t("Paiements")}</h2>
          <p className="text-sm">{t("{amount} par mois", { amount: fcfa(pass.monthlyFee) })}</p>
          {pass.payments.length === 0 ? (
            <p className="text-sm text-stone-600">{t("Aucun mois payé pour l'instant.")}</p>
          ) : (
            <ul className="divide-y divide-stone-100 text-sm">
              {pass.payments.map((p) => (
                <li key={p.id} className="flex justify-between py-2">
                  <span className="capitalize">{monthLabel(p.month, locale)}</span>
                  <span className="font-semibold text-emerald-700">{fcfa(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {history.length > 0 && (
          <section className={`${card} p-4`}>
            <h2 className="mb-2 font-semibold">{t("Derniers trajets")}</h2>
            <ol className="space-y-2">
              {history.map((tr) => (
                <TripLine key={tr.id} trip={tr} withDate />
              ))}
            </ol>
          </section>
        )}
      </div>
    </div>
  );
}

function TripLine({ trip, withDate = false }: { trip: SchoolTrip & { date: string }; withDate?: boolean }) {
  const { t, locale } = useI18n();
  const s = TRIP_STATUS[trip.status];
  const when = trip.droppedAt ?? trip.pickedUpAt ?? trip.startedAt;
  return (
    <li className="flex items-center gap-3">
      <span className="w-14 shrink-0 font-mono text-sm font-semibold">{hhmm(trip.scheduledAt)}</span>
      <span className="min-w-0 flex-1 text-sm">
        {t(LEG_LABEL[trip.leg])}
        {withDate && <span className="block text-xs capitalize text-stone-500">{dayLabel(trip.date, locale)}</span>}
        {when && trip.status !== "CANCELLED" && <span className="block text-xs text-stone-500">{t("à {time}", { time: hhmm(when) })}</span>}
        {trip.note && <span className="block text-xs text-stone-500">{trip.note}</span>}
        {trip.codeSkipped && <span className="block text-xs font-semibold text-red-700">{t("Remis sans code")}</span>}
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.tone}`}>{t(s.label)}</span>
    </li>
  );
}

function Absences({ pass, busy, act }: { pass: Detail; busy: boolean; act: (fn: () => Promise<unknown>, done?: string) => Promise<void> }) {
  const { t, locale } = useI18n();
  const [leg, setLeg] = useState<"BOTH" | Leg>("BOTH");
  return (
    <section className={`${card} space-y-3 p-4`}>
      <h2 className="font-semibold">{t("Absences")}</h2>
      <p className="text-sm text-stone-600">{t("Malade, sortie scolaire, pas d'école ? Signalez-le : le conducteur ne se déplace pas.")}</p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          act(async () => {
            await customerFetch(`/school/passes/${pass.id}/absences`, { method: "POST", body: { date: String(f.get("date")), leg, reason: String(f.get("reason") ?? "").trim() || null } });
            form.reset();
          }, t("Absence enregistrée."));
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            {t("Jour")}
            <input type="date" name="date" required min={pass.today} defaultValue={pass.today} className={`${input} mt-1`} />
          </label>
          <label className="block text-sm">
            {t("Trajets")}
            <select value={leg} onChange={(e) => setLeg(e.target.value as "BOTH" | Leg)} className={`${input} mt-1`}>
              {(["BOTH", "GO", "BACK"] as const).map((l) => (
                <option key={l} value={l}>
                  {t(ABSENCE_LEG[l])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <input name="reason" maxLength={200} placeholder={t("Raison (facultatif)")} className={input} />
        <button disabled={busy} className={primary}>
          {t("Signaler l'absence")}
        </button>
      </form>
      {pass.absences.length > 0 && (
        <ul className="divide-y divide-stone-100 text-sm">
          {pass.absences.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <span className="capitalize">{dayLabel(a.date, locale)}</span>
                <span className="block text-xs text-stone-500">
                  {t(ABSENCE_LEG[a.leg])}
                  {a.reason ? ` · ${a.reason}` : ""}
                </span>
              </span>
              {a.date > pass.today && (
                <button disabled={busy} onClick={() => act(() => customerFetch(`/school/passes/${pass.id}/absences/${a.id}`, { method: "DELETE" }))} className="text-sm text-red-700 underline">
                  {t("Retirer")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
