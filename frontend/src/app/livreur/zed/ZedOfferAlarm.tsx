"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRinging } from "@/components/panel/partner";
import { Icon } from "@/components/panel/icons";
import { distanceLabel, driverFetch, type ZedOffer } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";
import SwipeButton from "../SwipeButton";

// Appel Zed : plein écran, sonnerie, 15 secondes pour accepter. Sans réponse, l'appel passe au conducteur suivant.
// Ni destination ni prix : le client attend à sa position, le prix se fait sur place.
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

  return (
    <div role="alertdialog" aria-label={t("Appel Zed")} className="fixed inset-0 z-[60] flex flex-col items-center overflow-y-auto bg-ink p-5 text-white">
      <p className="self-start rounded-full bg-sun px-3 py-1 text-sm font-bold text-ink">ZED · {offer.ride.code}</p>
      <p className="mt-6 text-3xl font-bold">{t("Un client vous appelle")}</p>
      <p className="mt-1 text-white/70">{t("Il attend à sa position. Le prix se fait sur place.")}</p>

      <span aria-label={t("{n} secondes restantes", { n: left })} className="relative mt-8 grid h-40 w-40 place-items-center">
        <svg viewBox="0 0 120 120" className="absolute inset-0 h-40 w-40 -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r={R} fill="none" strokeWidth="8" className="stroke-white/15" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={ring}
            strokeDashoffset={ring * (1 - left / total)}
            className={`transition-[stroke-dashoffset] duration-300 ease-linear ${left <= 5 ? "stroke-coral" : "stroke-sun"}`}
          />
        </svg>
        <span className="text-center">
          <span className="block font-display text-5xl font-extrabold">{left}</span>
          <span className="text-xs text-white/70">{t("secondes")}</span>
        </span>
      </span>

      <dl className="mt-8 grid w-full grid-cols-1 gap-3">
        <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4">
          <Icon name="pin" className="h-7 w-7 shrink-0 text-sun" />
          <div>
            <dt className="text-xs uppercase tracking-wide text-white/60">{t("Client à")}</dt>
            <dd className="font-display text-3xl font-extrabold">{distanceLabel(offer.distanceM)}</dd>
          </div>
        </div>
        {offer.ride.landmark && (
          <div className="rounded-2xl bg-white/10 p-4">
            <dt className="text-xs uppercase tracking-wide text-white/60">{t("Repère donné par le client")}</dt>
            <dd className="font-semibold">{offer.ride.landmark}</dd>
          </div>
        )}
      </dl>

      {soundBlocked && <p className="mt-4 w-full rounded-lg bg-white/15 px-3 py-2 text-center text-sm">{t("Touchez l'écran une fois pour activer la sonnerie.")}</p>}
      {error && <p className="mt-4 w-full rounded-lg bg-red-600 px-3 py-2 text-sm">{error}</p>}

      <div className="mt-auto w-full space-y-3 pt-6">
        <SwipeButton tone="sun" label="Glisser pour accepter" disabled={busy || left === 0} onConfirm={() => answer("accept")} />
        <button disabled={busy} onClick={() => answer("decline")} className="w-full rounded-2xl px-6 py-3 font-semibold text-white/80">
          {t("Refuser")}
        </button>
      </div>
    </div>
  );
}
