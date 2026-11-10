"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, useSession, type Address, type Profile } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { tel } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { bookingDays, whenLabel } from "@/lib/booking";
import { slotIso } from "@/lib/serviceRequests";
import { card, primary, secondary, Skeleton, TopBar } from "../ui";
import ZedSwitch from "../ZedSwitch";
import type { GeoPoint } from "@/lib/api";

const NearbyMap = dynamic(() => import("./NearbyMap"), { ssr: false });

type Nearby = {
  count: number;
  radiusM: number;
  etaMin: number | null;
  drivers: GeoPoint[];
};

type Ride = {
  id: string;
  code: string;
  status: "SCHEDULED" | "SEARCHING" | "ACCEPTED" | "ONBOARD" | "COMPLETED" | "NO_DRIVER" | "CANCELLED";
  landmark: string | null;
  destination?: string | null;
  scheduledFor?: string | null;
  rating: number | null;
  alerted: number;
  cancelledBy: string | null;
  driver: {
    name: string;
    plate: string | null;
    phone: string | null;
    distance: string | null;
  } | null;
};

const POLL_MS = 3_000;

function position(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Votre téléphone ne donne pas sa position."));
    navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error("Autorisez la localisation pour qu'un Zed vous trouve.")), {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 30_000,
    });
  });
}

// Appeler un Zed (moto-taxi) : le client partage sa position, le conducteur le plus proche (1 km) a 15 s pour accepter,
// puis le suivant. Destination facultative pour aider le conducteur ; le prix se règle sur place. Compte client obligatoire.
export default function ZedCall() {
  const hydrated = useHydrated();
  const session = useSession();
  const { t, locale } = useI18n();
  const [ride, setRide] = useState<Ride | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [landmark, setLandmark] = useState("");
  const [destination, setDestination] = useState("");
  const [stars, setStars] = useState(0);
  const pollFailures = useRef(0);
  const [here, setHere] = useState<GeoPoint | null>(null);
  const [nearby, setNearby] = useState<Nearby | null>(null);
  const [places, setPlaces] = useState<Address[] | null>(null);
  // « Maintenant » (appel immédiat) ou « Plus tard » (course réservée : jour et heure).
  const [later, setLater] = useState(false);
  const days = useMemo(() => bookingDays(locale, new Date()), [locale, later]); // eslint-disable-line react-hooks/exhaustive-deps
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [booked, setBooked] = useState<Ride[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const formRef = useRef<HTMLElement>(null);

  const load = useCallback(async (id?: string) => {
    try {
      setRide(await customerFetch<Ride | null>(id ? `/zed/${id}` : "/zed/current"));
      pollFailures.current = 0;
    } catch (e) {
      if (++pollFailures.current > 3) setError((e as Error).message);
      if (!id) setRide(null);
    }
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // Attente : interrogation toutes les 3 s (fait aussi passer l'appel au conducteur suivant).
  const live = ride && ["SEARCHING", "ACCEPTED", "ONBOARD"].includes(ride.status);
  useEffect(() => {
    if (!live || !ride) return;
    const timer = setInterval(() => load(ride.id), ride.status === "SEARCHING" ? POLL_MS : POLL_MS * 2);
    return () => clearInterval(timer);
  }, [live, ride, load]);

  const fresh = !ride || ride.status === "CANCELLED" || ride.status === "NO_DRIVER" || (ride.status === "COMPLETED" && ride.rating !== null);
  const showMap = Boolean(session) && ride !== undefined && fresh;

  // Avant l'appel : position du client pour la carte, puis les Zed libres autour, rafraîchis toutes les 15 s.
  useEffect(() => {
    if (!showMap || here || !("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setHere({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }, [showMap, here]);
  useEffect(() => {
    if (!showMap || !here) return;
    const load = () => customerFetch<Nearby>(`/zed/nearby?latitude=${here.latitude}&longitude=${here.longitude}`).then(setNearby, () => {});
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [showMap, here]);

  // Courses réservées du client, relues toutes les 30 s (un Zed peut en retenir une entre-temps).
  const loadBooked = useCallback(() => customerFetch<Ride[]>("/zed/scheduled").then(setBooked, () => {}), []);
  useEffect(() => {
    if (!session) return;
    loadBooked();
    const timer = setInterval(loadBooked, 30_000);
    return () => clearInterval(timer);
  }, [session, loadBooked]);

  // Jour et heure proposés : le premier jour possible et la première heure libre de ce jour.
  const dayOk = days.find((d) => d.value === day) ?? days[0];
  const timeOk = dayOk && dayOk.times.includes(time) ? time : (dayOk?.times[0] ?? "");
  function bookLater() {
    setLater(true);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Adresses enregistrées du client : un appui les met comme destination (comme « Maison » ou « Bureau »).
  useEffect(() => {
    if (!showMap || places) return;
    customerFetch<Profile>("/me").then(
      (p) => setPlaces(p.addresses),
      () => setPlaces([]),
    );
  }, [showMap, places]);

  async function call() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (later && !destination.trim()) throw new Error(t("Indiquez où vous allez pour réserver une course"));
      const p = await position();
      const created = await customerFetch<Ride>("/zed", {
        method: "POST",
        body: {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
          landmark: landmark.trim() || undefined,
          destination: destination.trim() || undefined,
          scheduledFor: later && dayOk && timeOk ? slotIso(dayOk.value, timeOk) : undefined,
        },
      });
      if (created.status === "SCHEDULED") {
        // Réservée : la page reste prête pour un autre appel ; la course s'ajoute à « Mes courses réservées ».
        setNotice(t("Course réservée pour {quand}. Vous serez prévenu dès qu'un Zed la retient.", { quand: whenLabel(created.scheduledFor!, locale, t) }));
        setLater(false);
        setDestination("");
        await loadBooked();
      } else setRide(created);
    } catch (e) {
      const err = e as Error & { rideId?: string };
      if (err.rideId) await load(err.rideId);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooked(id: string) {
    setBusy(true);
    setError(null);
    try {
      await customerFetch<Ride>(`/zed/${id}/cancel`, { method: "POST" });
      await loadBooked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, body?: unknown) {
    if (!ride) return;
    setBusy(true);
    setError(null);
    try {
      setRide(
        await customerFetch<Ride>(`/zed/${ride.id}/${path}`, {
          method: "POST",
          body,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!hydrated) return null;
  if (!session)
    return (
      <div>
        <TopBar title="Zed" back="/app" />
        <section className={`${card} m-4 space-y-3 p-4`}>
          <p className="font-semibold">{t("Connectez-vous pour appeler un Zed")}</p>
          <p className="text-sm text-stone-600">{t("Le conducteur voit votre nom et peut vous appeler pour vous trouver.")}</p>
          <Link href="/app/connexion?suite=/app/zed" className={primary}>
            {t("Se connecter")}
          </Link>
        </section>
      </div>
    );

  const radiusLabel = nearby && nearby.radiusM >= 1000 ? `${nearby.radiusM / 1000} km` : `${nearby?.radiusM ?? 1000} m`;

  return (
    <div className="min-h-screen pb-28">
      {showMap ? (
        <div className="relative isolate h-[40vh] min-h-[260px] overflow-hidden bg-emerald-50 [&_.leaflet-bottom]:!bottom-7">
          {here ? (
            <NearbyMap me={here} radiusM={nearby?.radiusM ?? 1000} drivers={nearby?.drivers ?? []} />
          ) : (
            <div className="grid h-full place-items-center text-[14px] text-stone-500">{t("Localisation…")}</div>
          )}
          {/* Haut de la carte : retour, « Je suis à » (position du client) et Aide, comme sur une appli de course. */}
          <div className="absolute inset-x-0 top-0 z-[500] flex items-center gap-2 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]">
            <Link href="/app" aria-label={t("Retour")} className="liquid grid h-11 w-11 shrink-0 place-items-center rounded-full">
              <Icon name="back" className="h-5 w-5" />
            </Link>
            <div className="liquid flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-full px-4">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" aria-hidden="true" />
              <span className="min-w-0 leading-tight">
                <span className="block text-[11px] text-stone-500">{t("Je suis à")}</span>
                <span className="block truncate text-[15px] font-semibold">{here ? t("Ma position") : t("Localisation…")}</span>
              </span>
            </div>
            <Link href="/app/aide" className="liquid inline-flex h-12 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold">
              <Icon name="help" className="h-5 w-5" /> {t("Aide")}
            </Link>
          </div>
          {nearby && (
            <p className="liquid absolute bottom-[3.75rem] left-3 z-[500] inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold">
              <Icon name="rider" className={`h-4 w-4 ${nearby.count ? "text-emerald-700" : "text-stone-400"}`} />
              {nearby.count === 0
                ? t("Aucun Zed libre à moins de {r}", { r: radiusLabel })
                : t("{n} Zed libre(s) · environ {m} min", {
                    n: nearby.count,
                    m: nearby.etaMin ?? 1,
                  })}
            </p>
          )}
        </div>
      ) : (
        <TopBar title="Zed" back="/app" />
      )}
      <div className={`relative z-10 space-y-4 px-4 py-4 ${showMap ? "glass -mt-6 rounded-t-[14px] shadow-[0_-10px_30px_rgb(0_0_0/0.10)]" : ""}`}>
        {showMap && <span className="mx-auto -mt-1 mb-1 block h-1 w-10 rounded-full bg-stone-300" aria-hidden="true" />}
        {ride === undefined ? (
          <Skeleton rows={2} />
        ) : ride && ride.status === "SEARCHING" ? (
          <section className="space-y-5 rounded-[12px] bg-ink-deep p-6 text-center text-white">
            <div className="relative mx-auto grid h-36 w-36 place-items-center" aria-hidden="true">
              <span className="absolute inset-0 animate-ping rounded-full bg-sun/30" />
              <span className="absolute inset-4 rounded-full bg-sun/20" />
              <span className="relative grid h-20 w-20 place-items-center rounded-full bg-sun text-ink-deep">
                <Icon name="rider" className="h-10 w-10" />
              </span>
            </div>
            <div role="status">
              <p className="text-2xl font-bold">{t("Recherche d'un Zed…")}</p>
              <p className="mt-1 text-white/70">
                {ride.alerted > 1
                  ? t("Appel envoyé à {n} conducteurs proches, un par un.", {
                      n: ride.alerted,
                    })
                  : t("Le conducteur le plus proche reçoit votre appel.")}
              </p>
            </div>
            <button disabled={busy} onClick={() => act("cancel")} className="w-full rounded-2xl bg-white/10 px-4 py-3 font-semibold">
              {t("Annuler")}
            </button>
          </section>
        ) : ride && (ride.status === "ACCEPTED" || ride.status === "ONBOARD") && ride.driver ? (
          <section className={`${card} space-y-4 p-5`}>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
              <Icon name="check" className="h-4 w-4" />
              {ride.status === "ONBOARD" ? t("En route") : t("Votre Zed arrive")}
            </span>
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ink-deep text-xl font-bold text-sun">{ride.driver.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">{ride.driver.name}</p>
                {ride.driver.plate && <p className="inline-block rounded-md bg-sun px-2 py-1 font-mono text-sm font-bold text-ink-deep">{ride.driver.plate}</p>}
              </div>
              {ride.driver.distance && ride.status === "ACCEPTED" && (
                <div className="text-right">
                  <p className="font-display text-2xl font-extrabold">{ride.driver.distance}</p>
                  <p className="text-xs text-stone-500">{t("de vous")}</p>
                </div>
              )}
            </div>
            <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{t("Mettez-vous d'accord sur le prix avec le conducteur avant de monter.")}</p>
            {ride.driver.phone && (
              <a href={tel(ride.driver.phone)} className={primary}>
                <Icon name="phone" className="h-5 w-5" /> {t("Appeler le conducteur")}
              </a>
            )}
            {ride.status === "ACCEPTED" && (
              <button disabled={busy} onClick={() => act("cancel")} className="w-full py-2 text-sm font-semibold text-red-700">
                {t("Annuler")}
              </button>
            )}
          </section>
        ) : ride && ride.status === "COMPLETED" && ride.rating === null ? (
          <section className={`${card} space-y-4 p-5 text-center`}>
            <p className="text-xl font-bold">{t("Course terminée")}</p>
            <p className="text-stone-600">
              {t("Comment s'est passée la course avec {name} ?", {
                name: ride.driver?.name ?? t("votre conducteur"),
              })}
            </p>
            <div className="flex justify-center gap-2" role="radiogroup" aria-label={t("Note")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={stars === n}
                  aria-label={`${n}/5`}
                  onClick={() => setStars(n)}
                  className={`text-4xl ${n <= stars ? "text-sun" : "text-stone-300"}`}
                >
                  ★
                </button>
              ))}
            </div>
            <button disabled={busy || !stars} onClick={() => act("rating", { rating: stars })} className={primary}>
              {t("Envoyer ma note")}
            </button>
          </section>
        ) : null}

        {ride && ride.status === "NO_DRIVER" && (
          <section className={`${card} space-y-3 p-5`}>
            <p className="text-lg font-semibold">{t("Aucun Zed disponible près de vous")}</p>
            <p className="text-sm text-stone-600">{t("Aucun conducteur à moins de 1 km n'a accepté. Réessayez dans un instant, ou réservez votre course pour plus tard.")}</p>
            <button onClick={bookLater} className={secondary}>
              {t("Réserver pour plus tard")}
            </button>
          </section>
        )}
        {ride && ride.status === "COMPLETED" && ride.rating !== null && (
          <p className="rounded-xl bg-emerald-50 p-3 text-center text-sm text-emerald-800">{t("Merci pour votre note !")}</p>
        )}
        {ride && ride.status === "CANCELLED" && <p className="rounded-xl bg-stone-100 p-3 text-center text-sm text-stone-700">{t("Demande annulée.")}</p>}

        {fresh && ride !== undefined && (
          <section ref={formRef} className="scroll-mt-4 space-y-4">
            <ZedSwitch current="ride" compact />
            {booked.length > 0 && (
              <div className={`${card} divide-y divide-stone-200/70 px-4`} aria-label={t("Mes courses réservées")}>
                <p className="pb-1 pt-3 text-[13px] font-semibold uppercase tracking-wide text-stone-500">{t("Mes courses réservées")}</p>
                {booked.map((b) => (
                  <div key={b.id} className="flex items-center gap-3 py-3">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] ${b.driver ? "bg-emerald-600 text-white" : "bg-sun-soft text-ink-deep"}`}
                      aria-hidden="true"
                    >
                      <Icon name="clock" className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">
                        {b.scheduledFor ? whenLabel(b.scheduledFor, locale, t) : ""} · {b.destination}
                      </span>
                      <span className={`block truncate text-[13px] ${b.driver ? "text-emerald-700" : "text-stone-500"}`}>
                        {b.driver
                          ? t("Zed réservé : {name}{plate}", { name: b.driver.name, plate: b.driver.plate ? ` · ${b.driver.plate}` : "" })
                          : t("En attente d'un Zed · l'appel part 15 min avant")}
                      </span>
                    </span>
                    <button type="button" disabled={busy} onClick={() => cancelBooked(b.id)} className="shrink-0 text-[13px] font-semibold text-red-700">
                      {t("Annuler")}
                    </button>
                  </div>
                ))}
              </div>
            )}
            {!showMap && <p className="text-[15px] text-stone-500">{t("Un Zed vient vous chercher là où vous êtes.")}</p>}
            {/* « Où allez-vous ? » en grand, comme le champ de recherche d'une appli de course, et « Plus tard » pour réserver.
                Destination facultative pour un appel immédiat, obligatoire pour une course réservée. */}
            <div className="card-gloss flex items-center gap-3 rounded-[16px] bg-surface p-2 pr-3 shadow-[0_6px_20px_rgb(0_0_0/0.08)]">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-ink-deep text-sun" aria-hidden="true">
                <Icon name="search" className="h-5 w-5" />
              </span>
              <input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                maxLength={120}
                aria-label={later ? t("Où allez-vous ?") : t("Où allez-vous ? (facultatif)")}
                placeholder={t("Où allez-vous ?")}
                className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold outline-none placeholder:text-stone-900 dark:placeholder:text-stone-100"
              />
              {destination ? (
                <button
                  type="button"
                  onClick={() => setDestination("")}
                  aria-label={t("Effacer")}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-500"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => (later ? setLater(false) : bookLater())}
                aria-pressed={later}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold ${later ? "bg-ink-deep text-sun" : "bg-stone-100 text-stone-700"}`}
              >
                <Icon name="clock" className="h-4 w-4" />
                {t("Plus tard")}
              </button>
            </div>

            {later ? (
              /* Réservation : le jour (aujourd'hui, demain, jours de la semaine) puis l'heure, au quart d'heure. */
              <div className={`${card} space-y-3 p-4`} role="group" aria-label={t("Quand ?")}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[15px] font-semibold">{t("Quand voulez-vous partir ?")}</p>
                  <button type="button" onClick={() => setLater(false)} className="text-[13px] font-semibold text-emerald-700">
                    {t("Maintenant")}
                  </button>
                </div>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                  {days.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => setDay(d.value)}
                      aria-pressed={dayOk?.value === d.value}
                      className={`shrink-0 rounded-[10px] px-3 py-2 text-[13px] font-semibold ${dayOk?.value === d.value ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}
                    >
                      {t(d.label)}
                    </button>
                  ))}
                </div>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[15px] font-medium">{t("Heure")}</span>
                  <select value={timeOk} onChange={(e) => setTime(e.target.value)} className="rounded-[10px] bg-stone-100 px-3 py-2 text-[16px] font-semibold">
                    {(dayOk?.times ?? []).map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-[13px] text-stone-500">
                  {t("Les Zed proches voient votre course et peuvent la retenir à l'avance. Sinon, l'appel part tout seul 15 minutes avant l'heure.")}
                </p>
              </div>
            ) : (
              nearby &&
              nearby.count === 0 && (
                <div className="flex items-center gap-3 rounded-[12px] bg-sun-soft p-3">
                  <p className="min-w-0 flex-1 text-[13px] text-ink-deep">
                    {t("Aucun Zed libre près de vous maintenant. Réservez : un Zed peut retenir votre course à l'avance.")}
                  </p>
                  <button type="button" onClick={bookLater} className="shrink-0 rounded-[10px] bg-ink-deep px-3 py-2 text-[13px] font-semibold text-sun">
                    {t("Réserver")}
                  </button>
                </div>
              )
            )}
            {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

            {/* Point de rendez-vous puis adresses enregistrées : un appui choisit la destination. */}
            <div className={`${card} divide-y divide-stone-200/70 px-4`}>
              <label className="flex items-center gap-3 py-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-emerald-50 text-emerald-700" aria-hidden="true">
                  <Icon name="pin" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold">{t("Où le Zed vous attend")}</span>
                  <input
                    value={landmark}
                    onChange={(e) => setLandmark(e.target.value)}
                    maxLength={120}
                    aria-label={t("Repère (facultatif)")}
                    placeholder={t("Repère : ex. devant la pharmacie")}
                    className="w-full bg-transparent text-[14px] text-stone-700 outline-none placeholder:text-stone-400"
                  />
                </span>
              </label>
              {(places ?? []).slice(0, 3).map((a) => {
                const value = `${a.label} : ${a.quarter}${a.landmark ? `, ${a.landmark}` : ""}`;
                const on = destination === value;
                return (
                  <button key={a.id} type="button" onClick={() => setDestination(on ? "" : value)} aria-pressed={on} className="flex w-full items-center gap-3 py-3 text-left">
                    <span
                      className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] ${on ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}
                      aria-hidden="true"
                    >
                      <Icon name={/maison/i.test(a.label) ? "home" : "clock"} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{a.label}</span>
                      <span className="block truncate text-[13px] text-stone-500">{[a.quarter, a.landmark].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Icon name={on ? "check" : "chevron"} className={`h-4 w-4 shrink-0 ${on ? "text-emerald-700" : "text-stone-400"}`} />
                  </button>
                );
              })}
              {places && places.length === 0 && (
                <Link href="/app/adresses" className="flex items-center gap-3 py-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-stone-700" aria-hidden="true">
                    <Icon name="plus" className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold">{t("Enregistrer une adresse")}</span>
                    <span className="block text-[13px] text-stone-500">{t("Maison, bureau… à choisir en un appui")}</span>
                  </span>
                  <Icon name="chevron" className="h-4 w-4 shrink-0 text-stone-400" />
                </Link>
              )}
            </div>

            <p className="text-[13px] text-stone-500">{t("Le prix se fait avec le conducteur, sur place. Avec une destination, il sait où vous allez avant d'accepter.")}</p>
            {/* Bouton collant au-dessus de la barre d'onglets, posé sur un fond plein : le texte qui défile passe dessous sans jamais le chevaucher. */}
            <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 bg-gradient-to-t from-surface from-80% to-transparent px-4 pb-10 pt-5">
              <button
                disabled={busy}
                onClick={call}
                className="sheen inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sun px-4 py-4 text-lg font-bold text-ink-deep shadow-[0_8px_24px_rgb(0_0_0/0.18)] disabled:opacity-50"
              >
                {busy
                  ? t("Localisation…")
                  : later && dayOk && timeOk
                    ? t("Réserver pour {quand}", { quand: whenLabel(slotIso(dayOk.value, timeOk), locale, t) })
                    : t("Appeler un Zed")}
              </button>
            </div>
          </section>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
