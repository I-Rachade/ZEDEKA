"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { readDetails, type GeoPoint, type OrderDetails } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

const LiveMap = dynamic(() => import("./LiveMap"), { ssr: false, loading: () => <div className="skeleton h-full w-full" /> });

const VEHICLE = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" } as const;
// Vitesse moyenne d'une moto en ville, pour les minutes restantes quand la position du livreur est connue.
const KM_PER_MIN = 0.33;

function km(a: GeoPoint, b: GeoPoint) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export type LiveTrackProps = {
  code: string;
  parcel: boolean;
  live: boolean; // en route vers le client : la carte s'affiche
  ongoing: boolean;
  cancelled: boolean;
  eyebrow: string;
  title: string;
  sub: string;
  topTitle: string;
  bar: { labels: string[]; reached: number };
  etaTo: string | null;
  help: string | null;
  stamp: string;
};

// Haut du suivi, comme sur la planche : carte en direct pendant le trajet, puis la feuille avec la pastille
// « En direct », le titre, la case des minutes, la barre nommée et la carte du livreur avec sa plaque.
export default function LiveTrack(p: LiveTrackProps) {
  const t = useT();
  const router = useRouter();
  const [d, setD] = useState<OrderDetails | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = () => readDetails(p.code).then((x) => alive && setD(x), () => {});
    load();
    // Pendant le trajet, la moto avance : nouvelle position toutes les 10 s.
    const timer = p.live ? setInterval(load, 10_000) : null;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      clearInterval(tick);
    };
  }, [p.code, p.live, p.stamp]);

  const driverAt = d?.map?.driver ?? null;
  const to = d?.map?.to ?? null;
  const left = p.live && driverAt && to ? km(driverAt, to) : null;
  const minutes =
    left !== null ? Math.max(1, Math.round(left / KM_PER_MIN) + 1) : p.etaTo ? Math.max(1, Math.round((new Date(p.etaTo).getTime() - now) / 60_000)) : null;
  const arrival = minutes !== null ? new Date(now + minutes * 60_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" }) : null;
  const seconds = driverAt ? Math.max(0, Math.round((now - new Date(driverAt.at).getTime()) / 1000)) : null;
  const showMap = p.live && Boolean(d?.map && (d.map.to || d.map.from));
  const driver = d?.driver ?? null;

  return (
    <>
      {showMap ? (
        <div className="relative h-[46vh] min-h-[300px] overflow-hidden [&_.leaflet-bottom]:!bottom-7">
          <LiveMap from={d!.map!.from} to={d!.map!.to} driver={driverAt} fromEmoji={p.parcel ? "📦" : "🍗"} />
          <div className="absolute inset-x-0 top-0 z-[500] flex items-center gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <button type="button" onClick={() => router.push("/app/commandes")} aria-label={t("Retour")} className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-md">
              <Icon name="back" className="h-5 w-5" />
            </button>
            <span className="mx-auto rounded-full bg-white px-4 py-2 text-[15px] font-semibold shadow-md">
              {p.parcel ? t("Colis") : t("Commande")} {p.code}
            </span>
            <span className="w-11" aria-hidden="true" />
          </div>
        </div>
      ) : (
        <TopBar title={p.topTitle} back="/app/commandes" />
      )}

      <section className={`relative z-10 bg-white px-5 pb-5 pt-4 ${showMap ? "-mt-6 rounded-t-[28px] shadow-[0_-8px_30px_rgb(0_0_0/0.08)]" : "mx-4 mt-4 rounded-[20px]"}`}>
        {showMap && <span className="mx-auto mb-3 block h-1 w-10 rounded-full bg-stone-200" aria-hidden="true" />}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {p.ongoing ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-800">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />
                {seconds !== null ? t("En direct · position il y a {n} s", { n: seconds }) : t("En direct")}
              </span>
            ) : (
              <span className={`text-[13px] font-semibold uppercase tracking-wide ${p.cancelled ? "text-stone-500" : "text-emerald-600"}`}>{p.eyebrow}</span>
            )}
            <h1 className="mt-1.5 text-[26px] font-bold leading-tight">{left !== null && arrival ? t("Arrivée vers {time}", { time: arrival }) : p.title}</h1>
            {left !== null && driver ? (
              <p className="text-[15px] text-stone-500">{t("{name} est à {km} km", { name: driver.firstName, km: left.toFixed(1).replace(".", ",") })}</p>
            ) : (
              p.sub && <p className="text-[15px] text-stone-500">{p.sub}</p>
            )}
          </div>
          {p.ongoing && minutes !== null && (
            <div className="shrink-0 rounded-2xl border border-stone-200 px-3 py-2 text-center">
              <p className="leading-none">
                <span className="text-[28px] font-bold">{minutes}</span> <span className="text-[13px]">min</span>
              </p>
              <p className="mt-1 text-[12px] text-stone-500">{t("Arrivée {time}", { time: arrival ?? "" })}</p>
            </div>
          )}
        </div>

        {p.ongoing && (
          <div className="mt-4">
            <div className="flex gap-1" aria-hidden="true">
              {p.bar.labels.map((l, i) => (
                <span key={l} className={`h-1.5 flex-1 rounded-full ${i < p.bar.reached ? "bg-emerald-600" : i === p.bar.reached ? "step-now" : "bg-stone-200"}`} />
              ))}
            </div>
            <ol className="mt-1.5 flex gap-1 text-[11px]">
              {p.bar.labels.map((l, i) => (
                <li key={l} className={`flex-1 truncate text-center ${i === p.bar.reached ? "font-semibold text-stone-900" : "text-stone-400"}`} aria-current={i === p.bar.reached ? "step" : undefined}>
                  {l}
                </li>
              ))}
            </ol>
          </div>
        )}

        {driver && p.ongoing && (
          <div className="mt-4 rounded-2xl border border-stone-200 p-3">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sun text-xl font-bold text-ink">{driver.firstName.charAt(0)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-semibold">{driver.firstName}</span>
                <span className="block text-[13px] text-stone-500">
                  {[driver.rating !== null ? `★ ${driver.rating.toFixed(1).replace(".", ",")}` : null, t("{n} course(s)", { n: driver.deliveries.toLocaleString("fr-FR") })].filter(Boolean).join(" · ")}
                </span>
              </span>
              {p.help && (
                <a href={p.help} target="_blank" rel="noopener noreferrer" aria-label={t("Joindre le livreur par Zedeka")} className="grid h-11 w-11 place-items-center rounded-full bg-emerald-700 text-white">
                  <Icon name="phone" className="h-5 w-5" />
                </a>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-stone-50 px-3 py-2 text-[14px]">
              <span>🛵 {t(VEHICLE[driver.vehicle])}</span>
              {driver.plate && <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-[13px] font-bold text-white">{driver.plate}</span>}
            </div>
            <p className="mt-2 text-center text-[12px] text-stone-500">{t("L'appel passe par Zedeka : le numéro du livreur reste caché.")}</p>
          </div>
        )}
      </section>
    </>
  );
}
