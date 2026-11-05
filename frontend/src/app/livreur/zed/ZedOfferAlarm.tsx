"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRinging } from "@/components/panel/partner";
import { distanceLabel, driverFetch, type ZedOffer } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";

// Appel Zed : plein écran, sonnerie, 15 secondes pour accepter. Sans réponse, l'appel passe au conducteur suivant.
// Destination facultative donnée par le client ; pas de prix : il se fait sur place.
export default function ZedOfferAlarm({ offer, serverTime, onDone }: { offer: ZedOffer; serverTime: string; onDone: () => Promise<void> }) {
  const router = useRouter();
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [offset] = useState(() => new Date(serverTime).getTime() - Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soundBlocked = useRinging(true);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const left = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - (now + offset)) / 1000));
  const [total] = useState(() => Math.max(left, 1));
  useEffect(() => {
    if (left === 0) void onDone();
  }, [left, onDone]);
  const R = 52;
  const ring = 2 * Math.PI * R;

  async function answer(path: "accept" | "decline") {
    setBusy(true);
    setError(null);
    try {
      const r = await driverFetch<{ rideId?: string }>(`/zed/offers/${offer.id}/${path}`, { method: "POST" });
      await onDone();
      if (r.rideId) router.push(`/livreur/zed/course/${r.rideId}`);
    } catch (e) {
      setError((e as Error).message);
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  const minutes = Math.max(1, Math.round(offer.distanceM / 300));
  return (
    <div role="alertdialog" aria-label={t("Appel Zed")} className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto bg-ink px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-[calc(1.25rem+env(safe-area-inset-top))] text-white">
      <p className="inline-flex items-center gap-1.5 rounded-full bg-sun-soft px-3 py-1 text-[14px] font-bold text-amber-900">
        <span className="h-2 w-2 rounded-full bg-sun" /> {t("Nouvel appel Zed")}
      </p>

      <span aria-label={t("{n} secondes restantes", { n: left })} className="relative mt-6 grid h-44 w-44 place-items-center">
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-44 w-44 -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r={R} fill="none" strokeWidth="9" className="stroke-white/12" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={ring}
            strokeDashoffset={ring * (1 - left / total)}
            className={`transition-[stroke-dashoffset] duration-300 ease-linear ${left <= 5 ? "stroke-coral" : "stroke-sun"}`}
          />
        </svg>
        <span className="text-[52px] font-extrabold tabular-nums">{left} s</span>
      </span>

      <p className="mt-6 text-[30px] font-bold">{t("Client à {d}", { d: distanceLabel(offer.distanceM) })}</p>
      {offer.ride.landmark && <p className="mt-1 text-center text-white/80">{t("Repère : {place}", { place: offer.ride.landmark })}</p>}

      <dl className="mt-6 w-full space-y-3 rounded-[12px] bg-white/8 p-4">
        <div className="flex gap-3">
          <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          <div>
            <dt className="text-[12px] text-white/60">{t("Prendre")}</dt>
            <dd className="font-bold">
              {offer.ride.landmark ?? t("Position du client")} · {t("{n} min", { n: minutes })}
            </dd>
          </div>
        </div>
        {offer.ride.destination && (
          <div className="flex gap-3">
            <span className="w-3.5 shrink-0 text-[13px]" aria-hidden="true">
              🏁
            </span>
            <div>
              <dt className="text-[12px] text-white/60">{t("Destination")}</dt>
              <dd className="font-bold">{offer.ride.destination}</dd>
              <dd className="text-[12px] text-white/60">{t("Le prix se fait sur place avec le client.")}</dd>
            </div>
          </div>
        )}
      </dl>

      {soundBlocked && <p className="mt-4 w-full rounded-lg bg-white/15 px-3 py-2 text-center text-sm">{t("Touchez l'écran une fois pour activer la sonnerie.")}</p>}
      {error && <p className="mt-4 w-full rounded-lg bg-red-600 px-3 py-2 text-sm">{error}</p>}

      <div className="mt-auto w-full pt-6">
        <div className="grid grid-cols-[1fr_1.8fr] gap-3">
          <button disabled={busy} onClick={() => answer("decline")} className="rounded-[12px] bg-white/10 px-4 py-4 text-[17px] font-bold text-white">
            {t("Ignorer")}
          </button>
          <button disabled={busy || left === 0} onClick={() => answer("accept")} className="rounded-[12px] bg-sun px-4 py-4 text-[17px] font-bold text-ink disabled:opacity-50">
            {t("Accepter")}
          </button>
        </div>
        <p className="mt-3 text-center text-[13px] text-white/60">{t("Sonnerie et vibration. Sans réponse dans 15 s, l'appel passe aux autres conducteurs.")}</p>
      </div>
    </div>
  );
}
