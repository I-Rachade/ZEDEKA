"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogBox } from "@/components/DialogBox";
import { Icon } from "@/components/panel/icons";
import { customerFetch, useSession, type Address, type Profile } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { tel } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { bookingDays, whenLabel } from "@/lib/booking";
import { slotIso } from "@/lib/serviceRequests";
import { card, primary, secondary, Skeleton, TopBar } from "../ui";
import ZedSwitch from "../ZedSwitch";
import { searchPlaces, type GeoPoint, type PlaceResult } from "@/lib/api";

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
  quotedPrice?: number | null;
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

// Prix d'une course demandée : calculé sur l'itinéraire (départ → destination), donné avant l'arrivée du Zed.
type Quote = { price: number; distanceM: number; durationS: number };

// Texte d'une adresse enregistrée, tel que le conducteur le lit : « Maison : Bè, près du marché ».
const pointOf = (a: Address): GeoPoint | null => (a.latitude !== null && a.longitude !== null ? { latitude: a.latitude, longitude: a.longitude } : null);
const placeText = (a: Address) => `${a.label} : ${a.quarter}${a.landmark ? `, ${a.landmark}` : ""}`;

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
  // Point de la destination (adresse enregistrée ou lieu trouvé) : sert au prix d'une course demandée.
  const [destPoint, setDestPoint] = useState<GeoPoint | null>(null);
  const [suggestions, setSuggestions] = useState<PlaceResult[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
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
  // Départ : la position du téléphone par défaut, ou une adresse enregistrée (avec sa position) choisie dans la liste.
  const [pickup, setPickup] = useState<(Address & { latitude: number; longitude: number }) | null>(null);
  // Feuilles : choix du départ, de la destination, ou du jour et de l'heure (« Plus tard »).
  const [picker, setPicker] = useState<"from" | "to" | "when" | null>(null);
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
  const from = pickup ?? here;
  useEffect(() => {
    if (!showMap || !from) return;
    const load = () => customerFetch<Nearby>(`/zed/nearby?latitude=${from.latitude}&longitude=${from.longitude}`).then(setNearby, () => {});
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [showMap, from?.latitude, from?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setError(null);
    setPicker("when");
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

  // « Appeler un Zed » : un Zed libre à moins de 1 km, destination facultative, prix discuté sur place.
  // « Demander une course » : aucun Zed proche (un Zed plus loin vient), départ depuis une autre adresse, ou course
  // programmée. La destination est alors obligatoire et le prix de l'itinéraire est donné avant l'arrivée du Zed.
  const noneNear = Boolean(nearby && nearby.count === 0) || ride?.status === "NO_DRIVER";
  const request = later || Boolean(pickup) || noneNear;
  function chooseDestination(text: string, point: GeoPoint | null) {
    setDestination(text);
    setDestPoint(point);
    setSuggestions([]);
  }
  // Lieux proposés pendant la saisie de la destination (quartier, marché, rue…).
  useEffect(() => {
    const q = destination.trim();
    if (destPoint || q.length < 3) return setSuggestions([]);
    const timer = setTimeout(() => searchPlaces(q).then((r) => setSuggestions(r.slice(0, 4)), () => setSuggestions([])), 350);
    return () => clearTimeout(timer);
  }, [destination, destPoint]);
  // Prix de la course demandée, dès que départ et destination sont connus.
  useEffect(() => {
    setQuote(null);
    if (!request || !destPoint || !from) return;
    customerFetch<Quote>(
      `/zed/quote?fromLatitude=${from.latitude}&fromLongitude=${from.longitude}&toLatitude=${destPoint.latitude}&toLongitude=${destPoint.longitude}`,
    ).then(setQuote, () => {});
  }, [request, destPoint?.latitude, destPoint?.longitude, from?.latitude, from?.longitude]); // eslint-disable-line react-hooks/exhaustive-deps

  async function call() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (request && !destination.trim()) throw new Error(t("Indiquez votre destination pour demander une course"));
      const p = pickup ? { coords: { latitude: pickup.latitude, longitude: pickup.longitude, accuracy: 0 } } : await position();
      const pickupText = pickup ? [placeText(pickup), landmark.trim()].filter(Boolean).join(" · ").slice(0, 120) : landmark.trim();
      const created = await customerFetch<Ride>("/zed", {
        method: "POST",
        body: {
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: pickup ? undefined : p.coords.accuracy,
          landmark: pickupText || undefined,
          destination: destination.trim() || undefined,
          destinationLatitude: destPoint?.latitude,
          destinationLongitude: destPoint?.longitude,
          mode: request ? "REQUEST" : "CALL",
          scheduledFor: later && dayOk && timeOk ? slotIso(dayOk.value, timeOk) : undefined,
        },
      });
      if (created.status === "SCHEDULED") {
        // Réservée : la page reste prête pour un autre appel ; la course s'ajoute à « Mes courses réservées ».
        setNotice(t("Course réservée pour {quand}. Vous serez prévenu dès qu'un Zed la retient.", { quand: whenLabel(created.scheduledFor!, locale, t) }));
        setLater(false);
        chooseDestination("", null);
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
          {from ? (
            <NearbyMap me={from} radiusM={nearby?.radiusM ?? 1000} drivers={nearby?.drivers ?? []} />
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
                <span className="block truncate text-[15px] font-semibold">{pickup ? pickup.label : here ? t("Ma position") : t("Localisation…")}</span>
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
            {ride.quotedPrice ? (
              <p className="rounded-xl bg-sun-soft p-3 text-sm text-ink-deep">
                {t("Prix de la course")} : <strong>{ride.quotedPrice.toLocaleString(locale)} FCFA</strong>
                {ride.destination ? ` · ${ride.destination}` : ""}
              </p>
            ) : (
              <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{t("Mettez-vous d'accord sur le prix avec le conducteur avant de monter.")}</p>
            )}
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
            <p className="text-sm text-stone-600">
              {t("Aucun conducteur à moins de 1 km n'a accepté. Demandez une course : un Zed plus loin vient vous chercher, au prix de l'itinéraire. Ou programmez-la pour plus tard.")}
            </p>
            <button onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className={primary}>
              {t("Demander une course")}
            </button>
            <button onClick={bookLater} className={secondary}>
              {t("Programmer pour plus tard")}
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

            {/* Quand : « Maintenant » par défaut. « Plus tard » ouvre le choix du jour et de l'heure dans une feuille,
                l'écran principal ne garde que le créneau choisi. */}
            <div role="radiogroup" aria-label={t("Quand ?")} className="flex gap-1 rounded-[12px] bg-stone-100 p-1">
              <button
                type="button"
                role="radio"
                aria-checked={!later}
                onClick={() => setLater(false)}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[9px] py-2.5 text-[14px] font-semibold ${!later ? "bg-surface shadow-sm" : "text-stone-600"}`}
              >
                <Icon name="rider" className="h-4 w-4" />
                {t("Maintenant")}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={later}
                onClick={bookLater}
                className={`inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[9px] py-2.5 text-[14px] font-semibold ${later ? "bg-ink-deep text-sun shadow-sm" : "text-stone-600"}`}
              >
                <Icon name="clock" className="h-4 w-4 shrink-0" />
                <span className="truncate">{later && dayOk && timeOk ? whenLabel(slotIso(dayOk.value, timeOk), locale, t) : t("Plus tard")}</span>
              </button>
            </div>

            {/* Trajet : départ puis destination, reliés comme sur une appli de course. Les deux se choisissent. */}
            <div className={`${card} relative px-4`} role="group" aria-label={t("Trajet")}>
              <span className="absolute bottom-[3.4rem] left-[1.69rem] top-[3.4rem] w-0 border-l-2 border-dotted border-stone-300" aria-hidden="true" />
              <div className="flex items-center gap-3 border-b border-stone-200/70 py-3">
                <span className="relative grid h-7 w-7 shrink-0 place-items-center" aria-hidden="true">
                  <span className="h-3 w-3 rounded-full bg-emerald-600 ring-4 ring-emerald-600/20" />
                </span>
                <span className="min-w-0 flex-1">
                  <button type="button" onClick={() => setPicker("from")} className="flex w-full items-center gap-1 text-left">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium text-stone-500">{t("Départ")}</span>
                      <span className="block truncate text-[16px] font-semibold">{pickup ? pickup.label : t("Ma position actuelle")}</span>
                    </span>
                    <Icon name="chevron" className="h-4 w-4 shrink-0 text-stone-400" />
                  </button>
                  <input
                    value={landmark}
                    onChange={(e) => setLandmark(e.target.value)}
                    maxLength={120}
                    aria-label={t("Repère (facultatif)")}
                    placeholder={t("Repère : ex. devant la pharmacie")}
                    className="mt-0.5 w-full bg-transparent text-[14px] text-stone-700 outline-none placeholder:text-stone-400"
                  />
                </span>
              </div>
              <div className="flex items-center gap-3 py-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center" aria-hidden="true">
                  <span className="h-3 w-3 rounded-[3px] bg-ink-deep ring-4 ring-ink-deep/15" />
                </span>
                <label className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-stone-500">
                    {t("Destination")} {request ? "" : <span className="font-normal text-stone-400">{t("(facultatif)")}</span>}
                  </span>
                  <input
                    value={destination}
                    onChange={(e) => chooseDestination(e.target.value, null)}
                    maxLength={120}
                    aria-label={request ? t("Où allez-vous ?") : t("Où allez-vous ? (facultatif)")}
                    placeholder={t("Où allez-vous ?")}
                    className="w-full bg-transparent text-[16px] font-semibold outline-none placeholder:text-stone-400"
                  />
                </label>
                {destination ? (
                  <button
                    type="button"
                    onClick={() => chooseDestination("", null)}
                    aria-label={t("Effacer")}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-500"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPicker("to")}
                    aria-label={t("Choisir parmi mes adresses")}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-600"
                  >
                    <Icon name="home" className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Lieux trouvés pendant la saisie : un appui fixe la destination et son point sur la carte. */}
            {suggestions.length > 0 && (
              <ul className={`${card} -mt-2 divide-y divide-stone-200/70 px-4`} aria-label={t("Lieux trouvés")}>
                {suggestions.map((r) => (
                  <li key={`${r.latitude},${r.longitude}`}>
                    <button type="button" onClick={() => chooseDestination(r.name, { latitude: r.latitude, longitude: r.longitude })} className="flex w-full items-center gap-3 py-3 text-left">
                      <Icon name="pin" className="h-5 w-5 shrink-0 text-stone-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{r.name}</span>
                        <span className="block truncate text-[13px] text-stone-500">{r.detail}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Adresses enregistrées : un appui les met comme destination (comme « Maison » ou « Bureau »). */}
            {places && places.length > 0 ? (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]" aria-label={t("Mes adresses")}>
                {places.slice(0, 6).map((a) => {
                  const on = destination === placeText(a);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => (on ? chooseDestination("", null) : chooseDestination(placeText(a), pointOf(a)))}
                      aria-pressed={on}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold ${on ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`}
                    >
                      <Icon name={/maison/i.test(a.label) ? "home" : "pin"} className="h-4 w-4" />
                      {a.label}
                    </button>
                  );
                })}
              </div>
            ) : places ? (
              <Link href="/app/adresses" className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
                <Icon name="plus" className="h-4 w-4" />
                {t("Enregistrer une adresse : maison, bureau… à choisir en un appui")}
              </Link>
            ) : null}

            {!later && noneNear && (
              // Aucun Zed à moins de 1 km : on peut quand même partir maintenant, un Zed plus loin vient.
              <div className="space-y-2 rounded-[12px] bg-sun-soft p-3 text-ink-deep">
                <p className="text-[14px] font-semibold">{t("Aucun Zed libre à moins de 1 km")}</p>
                <p className="text-[13px]">{t("Demandez une course : un Zed plus loin vient vous chercher. Indiquez votre destination pour connaître le prix.")}</p>
                <button type="button" onClick={bookLater} className="text-[13px] font-semibold text-emerald-800 underline underline-offset-2">
                  {t("Ou programmer pour plus tard")}
                </button>
              </div>
            )}
            {request && destPoint && (
              // Prix de l'itinéraire, connu avant l'arrivée du Zed.
              <div className={`${card} flex items-center gap-3 p-4`}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-emerald-50 text-emerald-700" aria-hidden="true">
                  <Icon name="rider" className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-stone-500">{t("Prix de la course")}</span>
                  <span className="block text-[20px] font-bold">{quote ? `${quote.price.toLocaleString(locale)} FCFA` : t("Calcul…")}</span>
                </span>
                {quote && (
                  <span className="shrink-0 text-right text-[13px] text-stone-600">
                    {(quote.distanceM / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km
                    <span className="block">{t("environ {m} min", { m: Math.max(1, Math.round(quote.durationS / 60)) })}</span>
                  </span>
                )}
              </div>
            )}
            {notice && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}

            <p className="text-[13px] text-stone-500">
              {request
                ? t("Le prix est fixé sur l'itinéraire avant l'arrivée du Zed.")
                : t("Le prix se fait avec le conducteur, sur place. Avec une destination, il sait où vous allez avant d'accepter.")}
            </p>
            {/* « Appeler un Zed » seulement pour un départ immédiat depuis la position du client ; une course programmée
                ou qui part d'une autre adresse est une course à demander. */}
            {/* Bouton collant au-dessus de la barre d'onglets, posé sur un fond plein : le texte qui défile passe dessous sans jamais le chevaucher. */}
            <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 bg-gradient-to-t from-surface from-80% to-transparent px-4 pb-10 pt-5">
              <button
                disabled={busy}
                onClick={call}
                className="sheen inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sun px-4 py-4 text-lg font-bold text-ink-deep shadow-[0_8px_24px_rgb(0_0_0/0.18)] disabled:opacity-50"
              >
                {busy ? (
                  t("Localisation…")
                ) : later && dayOk && timeOk ? (
                  <span className="leading-tight">
                    {t("Demander une course")}
                    <span className="block text-[13px] font-semibold opacity-80">{whenLabel(slotIso(dayOk.value, timeOk), locale, t)}</span>
                  </span>
                ) : request ? (
                  quote ? (
                    t("Demander une course · {prix} FCFA", { prix: quote.price.toLocaleString(locale) })
                  ) : (
                    t("Demander une course")
                  )
                ) : (
                  t("Appeler un Zed")
                )}
              </button>
            </div>
          </section>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>

      {picker && (
        // Feuille qui monte du bas : choix du départ, de la destination, ou du jour et de l'heure.
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 text-ink" onClick={() => setPicker(null)}>
          <DialogBox
            onClose={() => setPicker(null)}
            aria-label={picker === "when" ? t("Quand voulez-vous partir ?") : picker === "from" ? t("D'où partez-vous ?") : t("Où allez-vous ?")}
            onClick={(e) => e.stopPropagation()}
            className="anim-slide-up mx-auto max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-stone-300" />
            {picker === "when" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{t("Quand voulez-vous partir ?")}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setLater(false);
                      setPicker(null);
                    }}
                    className="shrink-0 text-[14px] font-semibold text-emerald-700"
                  >
                    {t("Maintenant")}
                  </button>
                </div>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
                  {days.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => {
                        // Changer de jour garde l'heure affichée quand elle existe aussi ce jour-là.
                        setDay(d.value);
                        setTime(timeOk);
                      }}
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
                <button
                  type="button"
                  onClick={() => {
                    setLater(true);
                    setPicker(null);
                  }}
                  className="w-full rounded-2xl bg-ink-deep px-4 py-3.5 text-[16px] font-bold text-sun"
                >
                  {t("Valider")}{dayOk && timeOk ? ` · ${whenLabel(slotIso(dayOk.value, timeOk), locale, t)}` : ""}
                </button>
              </div>
            ) : (
              <div>
                <h2 className="mb-3 text-lg font-semibold">{picker === "from" ? t("D'où partez-vous ?") : t("Où allez-vous ?")}</h2>
                <ul className="divide-y divide-stone-200/70">
                  {picker === "from" && (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          setPickup(null);
                          setPicker(null);
                        }}
                        className="flex w-full items-center gap-3 py-3 text-left"
                      >
                        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] ${!pickup ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700"}`} aria-hidden="true">
                          <Icon name="pin" className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold">{t("Ma position actuelle")}</span>
                          <span className="block text-[13px] text-stone-500">{t("Le Zed vient là où se trouve votre téléphone")}</span>
                        </span>
                        {!pickup && <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-700" />}
                      </button>
                    </li>
                  )}
                  {(places ?? []).map((a) => {
                    const located = a.latitude !== null && a.longitude !== null;
                    const on = picker === "from" ? pickup?.id === a.id : destination === placeText(a);
                    const off = picker === "from" && !located;
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          disabled={off}
                          onClick={() => {
                            if (picker === "from") setPickup({ ...a, latitude: a.latitude!, longitude: a.longitude! });
                            else chooseDestination(placeText(a), pointOf(a));
                            setPicker(null);
                          }}
                          className="flex w-full items-center gap-3 py-3 text-left disabled:opacity-50"
                        >
                          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-[10px] ${on ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-700"}`} aria-hidden="true">
                            <Icon name={/maison/i.test(a.label) ? "home" : "pin"} className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-semibold">{a.label}</span>
                            <span className="block truncate text-[13px] text-stone-500">
                              {off ? t("Position non enregistrée pour cette adresse") : [a.quarter, a.landmark].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          {on && <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-700" />}
                        </button>
                      </li>
                    );
                  })}
                  <li>
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
                  </li>
                </ul>
              </div>
            )}
          </DialogBox>
        </div>
      )}
    </div>
  );
}
