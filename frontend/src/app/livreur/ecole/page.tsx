"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { driverFetch, mapsUrl, tel } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { hhmm, LEG_LABEL, scheduleText, TRIP_STATUS, type Leg, type PassKind, type Schedule, type TripStatus } from "@/lib/school";

type PassInfo = {
  id: string;
  kind: PassKind;
  riderName: string;
  riderGrade: string | null;
  schoolName: string;
  schoolAddress: string;
  schoolLatitude: number | null;
  schoolLongitude: number | null;
  homeAddress: string;
  homeLatitude: number | null;
  homeLongitude: number | null;
  emergencyName: string;
  emergencyPhone: string;
  emergency2Name: string | null;
  emergency2Phone: string | null;
  healthNote: string | null;
  note: string | null;
  customer: { name: string | null; phone: string };
};
type Trip = { id: string; leg: Leg; scheduledAt: string; status: TripStatus; codeSkipped: boolean; note: string | null; pass: PassInfo };
type State = { today: string; trips: Trip[]; passes: (PassInfo & { status: string; schedule: Schedule })[]; tomorrowTrips: number };

// Position envoyée pendant un trajet : le parent suit le conducteur sur la carte.
const LOCATION_MS = 15_000;

// Transport scolaire du conducteur attitré : trajets du jour dans l'ordre, et pour chacun les étapes
// « Je pars », « Pris en charge », « Remis » (code de remise pour un écolier) ou « Absent ».
export default function DriverSchoolPage() {
  const { t } = useI18n();
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await driverFetch<State>("/school"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const moving = state?.trips.some((tr) => tr.status === "ON_THE_WAY" || tr.status === "PICKED_UP") ?? false;
  const last = useRef<GeolocationPosition | null>(null);
  useEffect(() => {
    if (!moving || !("geolocation" in navigator)) return;
    const watch = navigator.geolocation.watchPosition((p) => (last.current = p), () => {}, { enableHighAccuracy: true, maximumAge: 10_000, timeout: 30_000 });
    const send = () => {
      const p = last.current;
      if (p) driverFetch("/location", { method: "POST", body: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy } }).catch(() => {});
    };
    const first = setTimeout(send, 2000);
    const timer = setInterval(send, LOCATION_MS);
    return () => {
      navigator.geolocation.clearWatch(watch);
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [moving]);

  if (!state)
    return (
      <div>
        <TopBar title="Transport scolaire" back="/livreur" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );

  return (
    <div>
      <TopBar title="Transport scolaire" back="/livreur" />
      <div className="space-y-4 p-4">
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {state.passes.length === 0 ? (
          <section className={`${card} space-y-2 p-4`}>
            <h2 className="text-lg font-semibold">{t("Devenez conducteur attitré")}</h2>
            <p className="text-sm text-stone-700">
              {t("Zedeka confie des élèves et des étudiants à des conducteurs Zed de confiance, chaque jour d'école, payés au mois. Pour les enfants, passez au bureau pour la vérification (casier judiciaire, entretien).")}
            </p>
          </section>
        ) : (
          <>
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">{t("Aujourd'hui")}</h2>
            {state.trips.length === 0 ? (
              <p className={`${card} p-4 text-sm text-stone-600`}>{t("Pas de trajet scolaire aujourd'hui.")}</p>
            ) : (
              <ul className="space-y-3">
                {state.trips.map((tr) => (
                  <TripCard key={tr.id} trip={tr} onDone={load} onError={setError} />
                ))}
              </ul>
            )}
            {state.tomorrowTrips > 0 && <p className="text-sm text-stone-600">{t("Demain : {n} trajet(s).", { n: state.tomorrowTrips })}</p>}
            <h2 className="pt-2 text-[13px] font-semibold uppercase tracking-wide text-stone-500">{t("Mes abonnés")}</h2>
            <ul className={`${card} divide-y divide-stone-100`}>
              {state.passes.map((p) => (
                <li key={p.id} className="p-4 text-sm">
                  <p className="font-semibold">
                    {p.kind === "SCHOOL" ? "🎒" : "🎓"} {p.riderName}
                    {p.riderGrade ? ` · ${p.riderGrade}` : ""}
                    {p.status === "PAUSED" && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">{t("En pause")}</span>}
                  </p>
                  <p className="text-stone-600">{scheduleText(p.schedule, t)}</p>
                  <p className="text-stone-600">
                    {p.homeAddress} → {p.schoolName}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function TripCard({ trip, onDone, onError }: { trip: Trip; onDone: () => Promise<void>; onError: (e: string | null) => void }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"code" | "nocode" | "missed" | null>(null);
  const p = trip.pass;
  const child = p.kind === "SCHOOL";
  const go = trip.leg === "GO";
  // Aller : on prend à la maison, on dépose à l'école. Retour : l'inverse.
  const from = go ? { label: t("Maison"), address: p.homeAddress, lat: p.homeLatitude, lng: p.homeLongitude } : { label: p.schoolName, address: p.schoolAddress, lat: p.schoolLatitude, lng: p.schoolLongitude };
  const to = go ? { label: p.schoolName, address: p.schoolAddress, lat: p.schoolLatitude, lng: p.schoolLongitude } : { label: t("Maison"), address: p.homeAddress, lat: p.homeLatitude, lng: p.homeLongitude };
  const s = TRIP_STATUS[trip.status];
  const done = trip.status === "DROPPED" || trip.status === "MISSED" || trip.status === "CANCELLED";

  async function step(path: string, body?: unknown) {
    setBusy(true);
    onError(null);
    try {
      let position: { latitude?: number; longitude?: number } = {};
      if (path === "drop" && "geolocation" in navigator)
        position = await new Promise((resolve) =>
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            () => resolve({}),
            { timeout: 5000, maximumAge: 30_000 },
          ),
        );
      await driverFetch(`/school/trips/${trip.id}/${path}`, { method: "POST", body: { ...(body as object), ...position } });
      setMode(null);
      await onDone();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`${card} space-y-3 p-4 ${trip.status === "PICKED_UP" ? "ring-2 ring-amber-400" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="font-mono text-lg font-bold">{hhmm(trip.scheduledAt)}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {child ? "🎒" : "🎓"} {p.riderName}
            {p.riderGrade ? <span className="font-normal text-stone-500"> · {p.riderGrade}</span> : null}
          </p>
          <p className="text-sm text-stone-600">
            {t(LEG_LABEL[trip.leg])} : {from.label} → {to.label}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${s.tone}`}>{t(s.label)}</span>
      </div>

      {!done && (
        <div className="space-y-1 rounded-xl bg-stone-50 p-3 text-sm">
          <p>
            <span className="text-stone-500">{trip.status === "PICKED_UP" ? t("Déposer à") : t("Prendre à")} : </span>
            {(trip.status === "PICKED_UP" ? to : from).address}
          </p>
          <a href={mapsUrl((trip.status === "PICKED_UP" ? to : from).lat, (trip.status === "PICKED_UP" ? to : from).lng, (trip.status === "PICKED_UP" ? to : from).address)} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
            {t("Itinéraire")}
          </a>
          {p.note && <p className="text-stone-700">📝 {p.note}</p>}
          {p.healthNote && <p className="text-red-700">⚕️ {p.healthNote}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <a href={tel(p.customer.phone)} className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
              {child ? t("Appeler le parent") : t("Appeler l'étudiant")}
            </a>
            <a href={tel(p.emergencyPhone)} className="rounded-full bg-stone-200 px-3 py-1.5 text-xs font-semibold">
              {t("Urgence : {name}", { name: p.emergencyName })}
            </a>
            {p.emergency2Phone && (
              <a href={tel(p.emergency2Phone)} className="rounded-full bg-stone-200 px-3 py-1.5 text-xs font-semibold">
                {p.emergency2Name ?? t("Second contact")}
              </a>
            )}
          </div>
        </div>
      )}
      {trip.note && done && <p className="text-sm text-stone-600">{trip.note}</p>}

      {trip.status === "PLANNED" && mode !== "missed" && (
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy} onClick={() => step("start")} className={`${secondary} !py-3 !text-[15px]`}>
            {t("Je pars")}
          </button>
          <button disabled={busy} onClick={() => step("pickup")} className={`${primary} !py-3 !text-[15px]`}>
            {t("Pris en charge")}
          </button>
        </div>
      )}
      {trip.status === "ON_THE_WAY" && mode !== "missed" && (
        <button disabled={busy} onClick={() => step("pickup")} className={primary}>
          {t("{name} est pris(e) en charge", { name: p.riderName })}
        </button>
      )}
      {(trip.status === "PLANNED" || trip.status === "ON_THE_WAY") &&
        (mode === "missed" ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              step("missed", { note: String(new FormData(e.currentTarget).get("note") ?? "").trim() });
            }}
          >
            <label className="block text-sm">
              {t("Que s'est-il passé ?")}
              <input name="note" required minLength={3} maxLength={200} className={`${input} mt-1`} placeholder={t("Personne à la maison, élève absent…")} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode(null)} className={`${secondary} !py-3 !text-[15px]`}>
                {t("Annuler")}
              </button>
              <button disabled={busy} className="rounded-2xl bg-red-600 py-3 font-semibold text-white">
                {t("Trajet non fait")}
              </button>
            </div>
          </form>
        ) : (
          <button onClick={() => setMode("missed")} className="text-sm text-red-700 underline">
            {t("Élève absent au départ")}
          </button>
        ))}

      {trip.status === "PICKED_UP" &&
        (!child ? (
          <button disabled={busy} onClick={() => step("drop")} className={primary}>
            {t("Arrivé : {name} est déposé(e)", { name: p.riderName })}
          </button>
        ) : mode === "nocode" ? (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              step("drop", { noCodeReason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
            }}
          >
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Sans code, le parent et l'équipe Zedeka sont prévenus tout de suite. Ne laissez jamais l'enfant seul.")}</p>
            <label className="block text-sm">
              {t("À qui remettez-vous l'enfant, et pourquoi sans code ?")}
              <input name="reason" required minLength={5} maxLength={200} className={`${input} mt-1`} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode(null)} className={`${secondary} !py-3 !text-[15px]`}>
                {t("Annuler")}
              </button>
              <button disabled={busy} className="rounded-2xl bg-amber-600 py-3 font-semibold text-white">
                {t("Remettre sans code")}
              </button>
            </div>
          </form>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              step("drop", { code: String(new FormData(e.currentTarget).get("code") ?? "").trim() });
            }}
          >
            <label className="block text-sm">
              {go ? t("Code de remise donné par l'école") : t("Code de remise donné par l'adulte à la maison")}
              <input name="code" required inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" className={`${input} mt-1 text-center font-mono text-2xl tracking-[0.5em]`} />
            </label>
            <button disabled={busy} className={primary}>
              {t("Valider la remise")}
            </button>
            <button type="button" onClick={() => setMode("nocode")} className="text-sm text-stone-600 underline">
              {t("Personne n'a le code")}
            </button>
          </form>
        ))}
    </li>
  );
}
