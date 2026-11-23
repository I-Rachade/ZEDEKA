"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import MapPicker, { type Point } from "@/components/MapPicker";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { customerFetch, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useI18n } from "@/lib/i18n/client";
import { DAYS, KIND_HINT, KIND_LABEL, PASS_STATUS, scheduleText, type Fees, type MonthState, type PassKind, type PassStatus, type Schedule } from "@/lib/school";
import { card, input, primary, secondary, Skeleton, TopBar } from "../ui";

type PassRow = {
  id: string;
  kind: PassKind;
  riderName: string;
  schoolName: string;
  status: PassStatus;
  monthlyFee: number;
  schedule: Schedule;
  driver: { name: string; plate: string | null } | null;
  month: MonthState;
};
type State = { passes: PassRow[]; fees: Fees; graceDays: number };

// Transport scolaire : les abonnements du parent (écoliers) ou de l'étudiant, et la demande d'un nouvel abonnement.
export default function SchoolPassesPage() {
  const hydrated = useHydrated();
  const session = useSession();
  const { t } = useI18n();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await customerFetch<State>("/school"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!hydrated) return <TopBar title="Transport scolaire" back="/app/profil" />;
  if (!session)
    return (
      <div>
        <TopBar title="Transport scolaire" back="/app/profil" />
        <div className="space-y-3 p-4">
          <Intro />
          <Link href="/app/connexion?suite=/app/ecole" className={primary}>
            {t("Se connecter pour s'abonner")}
          </Link>
        </div>
      </div>
    );

  if (creating && state)
    return (
      <NewPass
        fees={state.fees}
        onCancel={() => setCreating(false)}
        onCreated={async () => {
          setCreating(false);
          await load();
        }}
      />
    );

  return (
    <div>
      <TopBar title="Transport scolaire" back="/app/profil" />
      <div className="space-y-4 p-4">
        {!state ? (
          error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />
        ) : (
          <>
            {state.passes.length === 0 && <Intro fees={state.fees} />}
            {state.passes.length > 0 && (
              <ul className="space-y-3">
                {state.passes.map((p) => (
                  <li key={p.id}>
                    <Link href={`/app/ecole/${p.id}`} className={`${card} flex items-center gap-3 p-4`}>
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-2xl" aria-hidden="true">
                        {p.kind === "SCHOOL" ? "🎒" : "🎓"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{p.riderName}</span>
                        <span className="block truncate text-sm text-stone-600">{p.schoolName}</span>
                        <span className="block truncate text-xs text-stone-500">{scheduleText(p.schedule, t)}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${PASS_STATUS[p.status].tone}`}>{t(PASS_STATUS[p.status].label)}</span>
                          {p.status === "ACTIVE" && !p.month.paid && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${p.month.suspended ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                              {p.month.suspended ? t("Mois non payé : trajets arrêtés") : t("Mois à payer")}
                            </span>
                          )}
                        </span>
                      </span>
                      <Icon name="chevron" className="h-5 w-5 text-stone-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <button onClick={() => setCreating(true)} className={primary}>
              <Icon name="plus" className="h-5 w-5" />
              {t("Nouvel abonnement")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Intro({ fees }: { fees?: Fees }) {
  const t = useI18n().t;
  return (
    <section className={`${card} space-y-3 p-4`}>
      <h2 className="text-lg font-semibold">{t("La maison, l'école, et retour")}</h2>
      <p className="text-sm text-stone-700">
        {t("Abonnez votre enfant (ou abonnez-vous, étudiant) aux trajets de chaque jour d'école. Le même conducteur Zed attitré, vérifié par Zedeka, vient aux heures fixées.")}
      </p>
      <ul className="space-y-1.5 text-sm text-stone-700">
        <li>✅ {t("Notification quand votre enfant est pris en charge, puis arrivé")}</li>
        <li>📍 {t("Trajet suivi en direct sur la carte")}</li>
        <li>🔐 {t("Remise à l'école et à la maison avec un code secret")}</li>
        <li>🗓️ {t("Absences et jours fériés : pas de trajet, rien à faire")}</li>
      </ul>
      {fees && (
        <p className="text-sm font-semibold">
          {t("Écolier : {round} par mois aller-retour · Étudiant : {student} par mois", { round: fcfa(fees.SCHOOL.round), student: fcfa(fees.STUDENT.round) })}
        </p>
      )}
      <p className="text-xs text-stone-500">{t("Paiement chaque mois au bureau Zedeka (espèces ou virement), confirmé par l'équipe.")}</p>
    </section>
  );
}

type Slot = { on: boolean; go: string; back: string };
const WEEKDAYS = DAYS.slice(0, 5).map((d) => d.key);

function NewPass({ fees, onCancel, onCreated }: { fees: Fees; onCancel: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<PassKind>("SCHOOL");
  const [slots, setSlots] = useState<Record<string, Slot>>(() =>
    Object.fromEntries(DAYS.map((d) => [d.key, { on: WEEKDAYS.includes(d.key), go: "06:45", back: d.key === "3" ? "12:00" : "17:00" }])),
  );
  const [home, setHome] = useState<Point | null>(null);
  const [school, setSchool] = useState<Point | null>(null);
  const [picking, setPicking] = useState<"home" | "school" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schedule: Schedule = Object.fromEntries(
    Object.entries(slots)
      .filter(([, s]) => s.on && (s.go || s.back))
      .map(([k, s]) => [k, { ...(s.go ? { go: s.go } : {}), ...(s.back ? { back: s.back } : {}) }]),
  );
  const values = Object.values(schedule);
  const round = values.some((s) => s?.go) && values.some((s) => s?.back);
  const price = round ? fees[kind].round : fees[kind].oneWay;
  const child = kind === "SCHOOL";

  const setSlot = (key: string, patch: Partial<Slot>) => setSlots((all) => ({ ...all, [key]: { ...all[key], ...patch } }));

  return (
    <div>
      <TopBar title="Nouvel abonnement" onBack={onCancel} />
      <form
        className="space-y-4 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const get = (k: string) => String(f.get(k) ?? "").trim();
          setBusy(true);
          setError(null);
          try {
            await customerFetch("/school/passes", {
              method: "POST",
              body: {
                kind,
                riderName: get("riderName"),
                riderGrade: get("riderGrade") || null,
                schoolName: get("schoolName"),
                schoolAddress: get("schoolAddress"),
                schoolLatitude: school?.latitude ?? null,
                schoolLongitude: school?.longitude ?? null,
                homeAddress: get("homeAddress"),
                homeLatitude: home?.latitude ?? null,
                homeLongitude: home?.longitude ?? null,
                schedule,
                emergencyName: get("emergencyName"),
                emergencyPhone: get("emergencyPhone"),
                emergency2Name: get("emergency2Name") || null,
                emergency2Phone: get("emergency2Phone") || null,
                healthNote: get("healthNote") || null,
                note: get("note") || null,
                startsOn: get("startsOn") || null,
              },
            });
            onCreated();
          } catch (err) {
            setError((err as Error).message);
            window.scrollTo({ top: 0, behavior: "smooth" });
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <fieldset className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("Pour qui ?")}>
          {(["SCHOOL", "STUDENT"] as PassKind[]).map((k) => (
            <label key={k} className={`${card} flex cursor-pointer flex-col gap-1 p-3 ${kind === k ? "ring-2 ring-emerald-600" : ""}`}>
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
              <span className="text-2xl" aria-hidden="true">
                {k === "SCHOOL" ? "🎒" : "🎓"}
              </span>
              <span className="font-semibold">{t(KIND_LABEL[k])}</span>
              <span className="text-xs text-stone-600">{t(KIND_HINT[k])}</span>
            </label>
          ))}
        </fieldset>

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">{child ? t("L'élève") : t("Vous")}</h2>
          <label className="block text-sm">
            {child ? t("Nom et prénom de l'élève") : t("Votre nom et prénom")}
            <input name="riderName" required minLength={2} maxLength={80} className={`${input} mt-1`} autoComplete="off" />
          </label>
          <label className="block text-sm">
            {child ? t("Classe (facultatif)") : t("Filière, année (facultatif)")}
            <input name="riderGrade" maxLength={60} className={`${input} mt-1`} placeholder={child ? "CM1" : "Licence 2"} />
          </label>
        </section>

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">{t("Adresses")}</h2>
          <label className="block text-sm">
            {child ? t("Nom de l'école") : t("Université ou établissement")}
            <input name="schoolName" required minLength={2} maxLength={120} className={`${input} mt-1`} />
          </label>
          <label className="block text-sm">
            {t("Adresse de l'école (quartier, repère)")}
            <input name="schoolAddress" required minLength={3} maxLength={200} className={`${input} mt-1`} />
          </label>
          <button type="button" onClick={() => setPicking("school")} className={`${secondary} !py-3 !text-[15px]`}>
            <Icon name="pin" className="h-5 w-5" />
            {school ? t("Position de l'école placée ✓") : t("Placer l'école sur la carte")}
          </button>
          <label className="block text-sm">
            {t("Adresse de la maison (quartier, repère)")}
            <input name="homeAddress" required minLength={3} maxLength={200} className={`${input} mt-1`} />
          </label>
          <button type="button" onClick={() => setPicking("home")} className={`${secondary} !py-3 !text-[15px]`}>
            <Icon name="pin" className="h-5 w-5" />
            {home ? t("Position de la maison placée ✓") : t("Placer la maison sur la carte")}
          </button>
        </section>

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">{t("Jours et heures")}</h2>
          <p className="text-xs text-stone-600">{t("Aller : départ de la maison. Retour : départ de l'école. Laissez une heure vide pour un trajet simple.")}</p>
          <ul className="space-y-2">
            {DAYS.map((d) => {
              const s = slots[d.key];
              return (
                <li key={d.key} className="flex items-center gap-2">
                  <label className="flex w-24 shrink-0 items-center gap-2 text-sm">
                    <input type="checkbox" checked={s.on} onChange={(e) => setSlot(d.key, { on: e.target.checked })} className="h-5 w-5 accent-emerald-600" />
                    {t(d.long)}
                  </label>
                  <input
                    type="time"
                    aria-label={t("Aller le {day}", { day: t(d.long).toLowerCase() })}
                    value={s.go}
                    disabled={!s.on}
                    onChange={(e) => setSlot(d.key, { go: e.target.value })}
                    className={`${input} !px-2 !py-2 disabled:opacity-40`}
                  />
                  <input
                    type="time"
                    aria-label={t("Retour le {day}", { day: t(d.long).toLowerCase() })}
                    value={s.back}
                    disabled={!s.on}
                    onChange={(e) => setSlot(d.key, { back: e.target.value })}
                    className={`${input} !px-2 !py-2 disabled:opacity-40`}
                  />
                </li>
              );
            })}
          </ul>
          <label className="block text-sm">
            {t("Premier jour (facultatif)")}
            <input type="date" name="startsOn" className={`${input} mt-1`} />
          </label>
        </section>

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="font-semibold">{t("Contacts d'urgence")}</h2>
          <p className="text-xs text-stone-600">{t("Appelés si le conducteur ne vous joint pas. Ils ne sont vus que par le conducteur attitré et l'équipe Zedeka.")}</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              {t("Nom")}
              <input name="emergencyName" required minLength={2} maxLength={80} className={`${input} mt-1`} />
            </label>
            <label className="block text-sm">
              {t("Téléphone")}
              <input name="emergencyPhone" required inputMode="tel" className={`${input} mt-1`} placeholder="90 00 00 00" />
            </label>
            <label className="block text-sm">
              {t("Second contact (facultatif)")}
              <input name="emergency2Name" maxLength={80} className={`${input} mt-1`} />
            </label>
            <label className="block text-sm">
              {t("Son téléphone")}
              <input name="emergency2Phone" inputMode="tel" className={`${input} mt-1`} />
            </label>
          </div>
          <label className="block text-sm">
            {t("Santé : allergies, traitement (facultatif)")}
            <textarea name="healthNote" maxLength={300} rows={2} className={`${input} mt-1`} />
          </label>
          <label className="block text-sm">
            {t("À savoir pour le conducteur (facultatif)")}
            <textarea name="note" maxLength={300} rows={2} className={`${input} mt-1`} placeholder={child ? t("Portail bleu, sonner deux fois…") : undefined} />
          </label>
        </section>

        <section className={`${card} space-y-1 p-4`}>
          <p className="text-sm text-stone-600">{round ? t("Aller-retour") : t("Trajet simple")}</p>
          <p className="text-2xl font-bold">{t("{amount} par mois", { amount: fcfa(price) })}</p>
          <p className="text-xs text-stone-500">{t("Prix indicatif, confirmé par l'équipe à la validation. Paiement au bureau Zedeka chaque mois.")}</p>
        </section>

        <button disabled={busy || Object.keys(schedule).length === 0} className={primary}>
          {busy ? t("Envoi…") : t("Envoyer la demande")}
        </button>
      </form>
      {picking && (
        <MapPicker
          title={picking === "home" ? "Position de la maison" : "Position de l'école"}
          initial={picking === "home" ? home : school}
          onClose={() => setPicking(null)}
          onPick={(p) => {
            if (picking === "home") setHome(p);
            else setSchool(p);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}
