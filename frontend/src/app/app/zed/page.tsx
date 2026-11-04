"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { tel } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";
import { card, input, primary, secondary, Skeleton, TopBar } from "../ui";
import ZedSwitch from "../ZedSwitch";

type Ride = {
  id: string;
  code: string;
  status: "SEARCHING" | "ACCEPTED" | "ONBOARD" | "COMPLETED" | "NO_DRIVER" | "CANCELLED";
  landmark: string | null;
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
// puis le suivant. Pas de destination ni de prix : tout se règle sur place. Compte client obligatoire.
export default function ZedCall() {
  const hydrated = useHydrated();
  const session = useSession();
  const t = useT();
  const [ride, setRide] = useState<Ride | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [landmark, setLandmark] = useState("");
  const [stars, setStars] = useState(0);
  const pollFailures = useRef(0);

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

  const fresh = !ride || ride.status === "CANCELLED" || ride.status === "NO_DRIVER" || (ride.status === "COMPLETED" && ride.rating !== null);

  return (
    <div className="min-h-screen bg-stone-50">
      <TopBar title="Zed" back="/app" />
      {fresh && ride !== undefined && <ZedSwitch current="ride" />}
      <div className="space-y-4 px-4 py-4">
        {ride === undefined ? (
          <Skeleton rows={2} />
        ) : ride && ride.status === "SEARCHING" ? (
          <section className="space-y-5 rounded-[24px] bg-ink p-6 text-center text-white">
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
            <div className="rounded-[24px] bg-ink p-6 text-white">
              <p className="text-sm font-bold text-sun">ZED</p>
              <p className="mt-1 text-2xl font-bold">{t("Un moto-taxi vient vous chercher")}</p>
              <p className="mt-2 text-white/70">{t("Partagez votre position : le conducteur le plus proche arrive. Le prix se fait avec lui sur place.")}</p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-stone-600">{t("Repère (facultatif)")}</span>
              <input value={landmark} onChange={(e) => setLandmark(e.target.value)} maxLength={120} placeholder={t("Ex. devant la pharmacie")} className={input} />
            </label>
            <button
              disabled={busy}
              onClick={call}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-sun px-4 py-4 text-lg font-bold text-ink transition active:scale-[0.98] disabled:opacity-50"
            >
              <Icon name="pin" className="h-6 w-6" />
              {busy ? t("Localisation…") : t("Appeler un Zed ici")}
            </button>
          </section>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}
