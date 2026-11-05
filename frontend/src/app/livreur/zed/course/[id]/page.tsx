"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { card, input, primary, Skeleton, TopBar } from "@/app/app/ui";
import { driverFetch, mapsUrl, tel, type ZedRide } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";
import { useDriver } from "../../../DriverShell";
import SwipeButton from "../../../SwipeButton";
import LiveMap from "@/app/commande/[code]/LiveMap";

const CANCEL_REASONS = ["Panne", "Client introuvable", "Trop loin finalement"];
// Montants les plus courants à Lomé, en un geste ; « Autre montant » pour le reste.
const QUICK_PRICES = [400, 500, 600];

const km = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

function usePosition() {
  const [pos, setPos] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition((p) => setPos({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => {}, { enableHighAccuracy: true, maximumAge: 10_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return pos;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// Course Zed du conducteur : aller chercher le client, client à bord, course terminée (le conducteur redevient disponible).
export default function ZedCourse() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useT();
  const { reload } = useDriver();
  const [ride, setRide] = useState<ZedRide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<"cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState("");
  const [other, setOther] = useState(false);
  const me = usePosition();
  const now = useNow();

  const load = useCallback(async () => {
    try {
      setRide(await driverFetch<ZedRide>(`/zed/rides/${id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function step(path: string, body?: unknown, leave = false) {
    setBusy(true);
    setError(null);
    try {
      const r = await driverFetch<ZedRide | { ok: true }>(`/zed/rides/${id}/${path}`, { method: "POST", body });
      await reload();
      if (leave) router.replace("/livreur");
      else if ("id" in r) setRide(r);
      setSheet(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ride)
    return (
      <div>
        <TopBar title="Course Zed" back="/livreur" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );

  const open = ride.status === "ACCEPTED" || ride.status === "ONBOARD";
  const client = ride.customer.name || t("Client");

  const client_ = { latitude: ride.latitude, longitude: ride.longitude };
  const left = me && ride.status === "ACCEPTED" ? km(me, client_) : null;
  const reached = ride.status === "COMPLETED" ? 3 : ride.status === "ONBOARD" ? 2 : left !== null && left < 0.08 ? 1 : 0;
  const since = (iso: string | null) => {
    const sec = Math.max(0, Math.floor((now - new Date(iso ?? ride.createdAt).getTime()) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const priceValue = Number(price || 0);

  return (
    <div>
      <div className="relative h-[40vh] min-h-[220px] bg-stone-200 [&_.leaflet-bottom]:!bottom-7">
        <LiveMap from={null} to={client_} driver={me} />
        <div className="absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[500] flex items-center justify-between gap-2">
          <button onClick={() => router.push("/livreur")} aria-label={t("Retour")} className="grid h-11 w-11 place-items-center rounded-full bg-white shadow">
            <Icon name="back" className="h-5 w-5" />
          </button>
          <span className="truncate rounded-full bg-white px-4 py-2 text-[15px] font-bold shadow">Zed · {ride.code}</span>
          <a href={mapsUrl(ride.latitude, ride.longitude, ride.landmark ?? "")} target="_blank" rel="noreferrer" aria-label={t("Itinéraire")} className="grid h-11 w-11 place-items-center rounded-full bg-white text-emerald-700 shadow">
            <Icon name="map" className="h-5 w-5" />
          </a>
        </div>
      </div>
      <div className="relative z-10 -mt-5 space-y-4 rounded-t-[14px] bg-stone-50 px-4 pb-6 pt-4">
        <section aria-label={t("Étapes de la course")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {open && (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-[13px] font-semibold text-emerald-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                  <span className="tabular-nums">
                    {ride.status === "ONBOARD" ? t("Client à bord") : t("Vers le client")} · {since(ride.status === "ONBOARD" ? ride.onboardAt : ride.acceptedAt)}
                  </span>
                </span>
              )}
              <h1 className="mt-2 text-[24px] font-bold leading-tight">
                {ride.status === "ONBOARD" ? (ride.destination ? t("Vers {place}", { place: ride.destination }) : t("Client à bord")) : ride.landmark ? t("Vers {place}", { place: ride.landmark }) : t("Vers le client")}
              </h1>
              <p className="text-[14px] text-stone-600">
                {client}
                {left !== null && ` · ${t("{km} km restant", { km: left.toFixed(1).replace(".", ",") })}`}
                {ride.accuracy !== null && ride.accuracy >= 5 && ride.status === "ACCEPTED" && ` · ${t("Position à {n} m près", { n: Math.round(ride.accuracy) })}`}
              </p>
            </div>
            {open && (
              <a href={tel(ride.customer.phone)} aria-label={t("Appeler")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                <Icon name="phone" className="h-5 w-5" />
              </a>
            )}
          </div>
          <div className="mt-3 flex gap-1" aria-hidden="true">
            {["Acceptée", "Arrivé", "À bord", "Terminée"].map((l, i) => (
              <span key={l} className={`h-1.5 flex-1 rounded-full ${i < reached ? "bg-emerald-600" : i === reached ? "step-now" : "bg-stone-200"}`} />
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[11px]">
            {["Acceptée", "Arrivé", "À bord", "Terminée"].map((l, i) => (
              <span key={l} aria-current={i === reached ? "step" : undefined} className={`flex-1 ${i === reached ? "font-semibold text-stone-900" : "text-stone-400"}`}>
                {t(l)}
              </span>
            ))}
          </div>
        </section>

        {ride.status === "ACCEPTED" && ride.destination && (
          <p className="rounded-[10px] bg-white px-4 py-3 text-[14px] ring-1 ring-stone-200">
            🏁 {t("Destination du client")} : <strong>{ride.destination}</strong>
          </p>
        )}

        {ride.status === "ONBOARD" && (
          <fieldset className={`${card} p-4`}>
            <legend className="sr-only">{t("Prix convenu (facultatif)")}</legend>
            <p className="font-bold" aria-hidden="true">
              {t("Prix convenu (facultatif)")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_PRICES.map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => {
                    setOther(false);
                    setPrice(price === String(p) ? "" : String(p));
                  }}
                  aria-pressed={!other && price === String(p)}
                  className={`min-w-16 rounded-full border px-4 py-2 text-[15px] font-semibold tabular-nums ${!other && price === String(p) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300 bg-white"}`}
                >
                  {p}
                </button>
              ))}
              <button type="button" onClick={() => setOther(true)} aria-pressed={other} className={`rounded-full border px-4 py-2 text-[15px] font-semibold ${other ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300 bg-white"}`}>
                {t("Autre…")}
              </button>
            </div>
            {other && <input value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={t("Autre montant")} aria-label={t("Autre montant")} className={`${input} mt-3`} autoFocus />}
            <p className="mt-2 text-[13px] text-stone-500">{t("Noté même sans réseau, envoyé ensuite.")}</p>
          </fieldset>
        )}

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {ride.status === "ACCEPTED" && (
          <>
            <SwipeButton label="Client à bord" disabled={busy} onConfirm={() => step("onboard")} />
            <button onClick={() => setSheet("cancel")} className="w-full py-2 text-sm font-semibold text-red-700">
              {t("Je ne peux pas venir")}
            </button>
          </>
        )}
        {ride.status === "ONBOARD" && <SwipeButton label="Glisser : terminer la course" disabled={busy} onConfirm={() => step("complete", priceValue ? { price: priceValue } : {}, true)} />}
        {!open && (
          <div className={`${card} p-4 text-center`}>
            <p className="font-semibold">{ride.status === "COMPLETED" ? t("Course terminée") : t("Course annulée")}</p>
            <button onClick={() => router.replace("/livreur")} className={`${primary} mt-3`}>
              {t("Retour à l'accueil")}
            </button>
          </div>
        )}

        {sheet === "cancel" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              step("cancel", { reason }, true);
            }}
            className={`${card} space-y-3 p-4`}
          >
            <p className="font-semibold">{t("Pourquoi ne pouvez-vous pas venir ?")}</p>
            <div className="flex flex-wrap gap-2">
              {CANCEL_REASONS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setReason(t(r))}
                  aria-pressed={reason === t(r)}
                  className={`rounded-full border px-3 py-2 text-sm ${reason === t(r) ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300"}`}
                >
                  {t(r)}
                </button>
              ))}
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              minLength={3}
              maxLength={200}
              placeholder={t("Ou écrivez la raison")}
              aria-label={t("Raison")}
              className={input}
            />
            <p className="text-xs text-stone-500">{t("L'appel repart vers les autres conducteurs proches.")}</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSheet(null)} className="flex-1 rounded-xl border border-stone-300 px-4 py-3">
                {t("Retour")}
              </button>
              <button disabled={busy || reason.trim().length < 3} className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-50">
                {t("Libérer le client")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
