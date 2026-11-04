"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { tel } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";
import { card, primary, secondary, Skeleton, TopBar } from "../ui";
import ZedSwitch from "../ZedSwitch";
import type { GeoPoint } from "@/lib/api";

const NearbyMap = dynamic(() => import("./NearbyMap"), { ssr: false });

type Nearby = { count: number; radiusM: number; etaMin: number | null; drivers: GeoPoint[] };

type Ride = {
  id: string;
  code: string;
  status: "SEARCHING" | "ACCEPTED" | "ONBOARD" | "COMPLETED" | "NO_DRIVER" | "CANCELLED";
  landmark: string | null;
  destination?: string | null;
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
  const t = useT();
  const [ride, setRide] = useState<Ride | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [landmark, setLandmark] = useState("");
  const [destination, setDestination] = useState("");
  const [stars, setStars] = useState(0);
  const pollFailures = useRef(0);
  const [here, setHere] = useState<GeoPoint | null>(null);
  const [nearby, setNearby] = useState<Nearby | null>(null);

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
    const load = () =>
      customerFetch<Nearby>(`/zed/nearby?latitude=${here.latitude}&longitude=${here.longitude}`).then(setNearby, () => {});
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [showMap, here]);

  async function call() {
    setBusy(true);
    setError(null);
    try {
      const p = await position();
      setRide(
        await customerFetch<Ride>("/zed", {
          method: "POST",
          body: {
            latitude: p.coords.latitude,
            longitude: p.coords.longitude,
            accuracy: p.coords.accuracy,
            landmark: landmark.trim() || undefined,
            destination: destination.trim() || undefined,
          },
        }),
      );
    } catch (e) {
      const err = e as Error & { rideId?: string };
      if (err.rideId) await load(err.rideId);
      else setError(err.message);
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
        <div className="relative h-[44vh] min-h-[300px] overflow-hidden bg-emerald-50 [&_.leaflet-bottom]:!bottom-7">
          {here ? (
            <NearbyMap me={here} radiusM={nearby?.radiusM ?? 1000} drivers={nearby?.drivers ?? []} />
          ) : (
            <div className="grid h-full place-items-center text-[14px] text-stone-500">{t("Localisation…")}</div>
          )}
          <div className="absolute inset-x-0 top-0 z-[500] space-y-1 pt-[calc(0.5rem+env(safe-area-inset-top))]">
            <div className="flex items-center gap-3 px-4">
              <Link href="/app" aria-label={t("Retour")} className="liquid grid h-11 w-11 place-items-center rounded-full">
                <Icon name="back" className="h-5 w-5" />
              </Link>
              <span className="text-[22px] font-bold drop-shadow-[0_1px_2px_rgb(255_255_255/0.9)]">Zed</span>
            </div>
            <div className="liquid mx-3 rounded-[12px] pb-2">
              <ZedSwitch current="ride" />
            </div>
          </div>
        </div>
      ) : (
        <TopBar title="Zed" back="/app" />
      )}
      <div className={`relative z-10 space-y-4 px-4 py-4 ${showMap ? "glass -mt-6 rounded-t-[14px] shadow-[0_-10px_30px_rgb(0_0_0/0.10)]" : ""}`}>
        {showMap && <span className="mx-auto -mt-1 mb-1 block h-1 w-10 rounded-full bg-stone-300" aria-hidden="true" />}
        {ride === undefined ? (
          <Skeleton rows={2} />
        ) : ride && ride.status === "SEARCHING" ? (
          <section className="space-y-5 rounded-[12px] bg-ink p-6 text-center text-white">
            <div className="relative mx-auto grid h-36 w-36 place-items-center" aria-hidden="true">
              <span className="absolute inset-0 animate-ping rounded-full bg-sun/30" />
              <span className="absolute inset-4 rounded-full bg-sun/20" />
              <span className="relative grid h-20 w-20 place-items-center rounded-full bg-sun text-ink">
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
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
              <Icon name="check" className="h-4 w-4" />
              {ride.status === "ONBOARD" ? t("En route") : t("Votre Zed arrive")}
            </span>
            <div className="flex items-center gap-3">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ink text-xl font-bold text-sun">{ride.driver.name.slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">{ride.driver.name}</p>
                {ride.driver.plate && <p className="inline-block rounded-md bg-sun px-2 py-0.5 font-mono text-sm font-bold text-ink">{ride.driver.plate}</p>}
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
            <p className="text-sm text-stone-600">{t("Aucun conducteur à moins de 1 km n'a accepté. Réessayez dans un instant, ou commandez un Ride.")}</p>
            <button disabled className={secondary}>
              {t("Commander un Ride (bientôt)")}
            </button>
          </section>
        )}
        {ride && ride.status === "COMPLETED" && ride.rating !== null && (
          <p className="rounded-xl bg-emerald-50 p-3 text-center text-sm text-emerald-800">{t("Merci pour votre note !")}</p>
        )}
        {ride && ride.status === "CANCELLED" && <p className="rounded-xl bg-stone-100 p-3 text-center text-sm text-stone-700">{t("Demande annulée.")}</p>}

        {fresh && ride !== undefined && (
          <section className="space-y-4">
            <div>
              <h1 className="text-[28px] font-bold leading-tight">{t("Une course pour moi")}</h1>
              <p className="text-[15px] text-stone-500">
                {!nearby
                  ? t("Un Zed vient vous chercher là où vous êtes.")
                  : nearby.count === 0
                    ? t("Aucun Zed libre à moins de {r} pour l'instant", { r: radiusLabel })
                    : t("{n} Zed libre(s) à moins de {r} · environ {m} min", { n: nearby.count, r: radiusLabel, m: nearby.etaMin ?? 1 })}
              </p>
            </div>
            <div className={`${card} p-4`}>
              <label className="flex items-start gap-3">
                <span className="mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-stone-500">{t("Je suis à")}</span>
                  <span className="block text-[16px] font-semibold">{here ? t("Ma position") : t("Ma position (au moment de l'appel)")}</span>
                  <input
                    value={landmark}
                    onChange={(e) => setLandmark(e.target.value)}
                    maxLength={120}
                    aria-label={t("Repère (facultatif)")}
                    placeholder={t("Repère : ex. devant la pharmacie")}
                    className="mt-0.5 w-full bg-transparent text-[14px] text-stone-700 outline-none placeholder:text-stone-400"
                  />
                </span>
              </label>
              <div className="my-1 ml-[6px] h-4 border-l-2 border-dotted border-stone-300" aria-hidden="true" />
              <label className="flex items-start gap-3">
                <span className="mt-0.5 text-[15px]" aria-hidden="true">🏁</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-stone-500">{t("Je vais à (facultatif)")}</span>
                  <input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    maxLength={120}
                    aria-label={t("Je vais à (facultatif)")}
                    placeholder={t("Ex. Grand marché, Assigamé")}
                    className="w-full bg-transparent text-[16px] font-semibold outline-none placeholder:font-normal placeholder:text-stone-400"
                  />
                </span>
              </label>
            </div>
            <p className="text-[13px] text-stone-500">{t("Le prix se fait avec le conducteur, sur place. Avec une destination, il sait où vous allez avant d'accepter.")}</p>
            <button
              disabled={busy}
              onClick={call}
              className="sheen inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sun px-4 py-4 text-lg font-bold text-ink disabled:opacity-50"
            >
              {busy ? t("Localisation…") : t("Appeler un Zed")}
            </button>
          </section>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
