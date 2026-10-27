"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRinging } from "@/components/panel/partner";
import { fcfa } from "@/lib/api";
import { LogoMark } from "@/components/Logo";
import { distanceKm, km } from "@/lib/customer";
import { driverFetch, REJECT_REASONS, type Offer } from "@/lib/driver";
import SwipeButton from "./SwipeButton";

// Course proposée par la répartition : plein écran, sonnerie, 60 secondes pour accepter ou refuser.
// Le gain est le chiffre le plus grand ; le temps restant tourne en anneau ; on glisse pour accepter (pas d'acceptation dans la poche).
export default function OfferAlarm({ offer, serverTime, onDone }: { offer: Offer; serverTime: string; onDone: () => Promise<void> }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [offset] = useState(() => new Date(serverTime).getTime() - Date.now()); // horloge du téléphone parfois fausse
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const soundBlocked = useRinging(!rejecting);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const left = Math.max(0, Math.ceil((new Date(offer.expiresAt).getTime() - (now + offset)) / 1000));
  const [total] = useState(() => Math.max(left, 1));
  const o = offer.order;
  const pickup = o.restaurant ? `${o.restaurant.name} · ${o.restaurant.address}` : (o.pickupAddress ?? "");
  const earning = o.driverEarning || o.deliveryFee + o.extraFee;
  const trip = o.restaurant?.latitude != null && o.restaurant.longitude != null ? distanceKm({ latitude: o.restaurant.latitude, longitude: o.restaurant.longitude }, o) : null;
  const R = 25;
  const ring = 2 * Math.PI * R;

  async function answer(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const r = await driverFetch<{ orderId?: string }>(`/assignments/${offer.id}/${path}`, { method: "POST", body });
      await onDone();
      if (r.orderId) router.push(`/livreur/course/${r.orderId}`);
    } catch (e) {
      setError((e as Error).message);
      await onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alertdialog" aria-label={`Nouvelle course ${o.code}`} className="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-emerald-950 p-5 text-white">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm text-emerald-100">
          <LogoMark className="h-6 w-6" />
          {o.type === "FOOD" ? "Repas" : "Colis"} · {o.code}
        </p>
        <span aria-label={`${left} secondes restantes`} className="relative grid h-16 w-16 place-items-center">
          <svg viewBox="0 0 58 58" className="absolute inset-0 h-16 w-16 -rotate-90" aria-hidden="true">
            <circle cx="29" cy="29" r={R} fill="none" strokeWidth="5" className="stroke-white/15" />
            <circle
              cx="29"
              cy="29"
              r={R}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={ring}
              strokeDashoffset={ring * (1 - left / total)}
              className={`transition-[stroke-dashoffset] duration-500 ease-linear ${left <= 15 ? "stroke-coral" : "stroke-sun"}`}
            />
          </svg>
          <span className="font-display text-xl font-extrabold">{left}</span>
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold">Nouvelle course</p>
      <p className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-5xl font-extrabold tracking-tight text-sun">{earning.toLocaleString("fr-FR")}</span>
        <span className="text-emerald-100">FCFA pour vous</span>
      </p>

      <ol className="mt-5 space-y-4 rounded-2xl bg-white/10 p-4">
        <li className="flex gap-3">
          <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-sun" />
          <div>
            <p className="text-xs uppercase tracking-wide text-emerald-100">Ramassage</p>
            <p className="font-semibold">{pickup}</p>
          </div>
        </li>
        <li className="flex gap-3">
          <span className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full bg-white" />
          <div>
            <p className="text-xs uppercase tracking-wide text-emerald-100">Livraison · {o.zone.name.split(" (")[0]}</p>
            <p className="font-semibold">{o.address}</p>
          </div>
        </li>
      </ol>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/10 p-3">
          <dt className="text-xs text-emerald-100">Trajet</dt>
          <dd className="font-display text-lg font-extrabold">{trip !== null ? km(trip) : o.zone.name.split(" (")[0]}</dd>
        </div>
        <div className={`rounded-2xl p-3 ${o.cashDue ? "bg-sun/20" : "bg-white/10"}`}>
          <dt className="text-xs text-emerald-100">À encaisser</dt>
          <dd className="font-display text-lg font-extrabold">{o.cashDue ? fcfa(o.cashDue) : "Déjà payé"}</dd>
        </div>
      </dl>

      {soundBlocked && !rejecting && <p className="mt-4 rounded-lg bg-white/15 px-3 py-2 text-center text-sm">Touchez l&apos;écran une fois pour activer la sonnerie.</p>}
      {error && <p className="mt-4 rounded-lg bg-red-600 px-3 py-2 text-sm">{error}</p>}

      <div className="mt-auto space-y-3 pt-6">
        {!rejecting ? (
          <>
            <SwipeButton tone="sun" label="Glisser pour accepter" disabled={busy || left === 0} onConfirm={() => answer("accept")} />
            <button disabled={busy} onClick={() => setRejecting(true)} className="w-full rounded-2xl px-6 py-3 font-semibold text-emerald-100">
              Refuser
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              answer("reject", { reason });
            }}
            className="space-y-3 rounded-2xl bg-white p-4 text-stone-900"
          >
            <p className="font-semibold">Pourquoi refuser ?</p>
            <div className="flex flex-wrap gap-2">
              {REJECT_REASONS.map((r) => (
                <button
                  type="button"
                  key={r}
                  onClick={() => setReason(r)}
                  aria-pressed={reason === r}
                  className={`rounded-full border px-3 py-1.5 text-sm ${reason === r ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300"}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200} placeholder="Ou écrivez la raison" aria-label="Raison du refus" className="w-full rounded-xl border border-stone-300 px-3 py-3" />
            <div className="flex gap-2">
              <button type="button" onClick={() => setRejecting(false)} className="flex-1 rounded-xl border border-stone-300 px-4 py-3">
                Retour
              </button>
              <button disabled={busy || reason.trim().length < 3} className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-50">
                Refuser la course
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
