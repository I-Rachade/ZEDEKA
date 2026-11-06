"use client";

import { DialogBox } from "@/components/DialogBox";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, ISSUE_KINDS, mapsUrl, NetworkError, sendStep, shownStatus, tel, timeOf, useQueue, type DriverOrder } from "@/lib/driver";
import { useDriver } from "../../DriverShell";
import SwipeButton from "../../SwipeButton";
import { useT } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import LiveMap from "@/app/commande/[code]/LiveMap";

type Sheet = "handover" | "issue" | null;

const km = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const point = (lat: number | null | undefined, lng: number | null | undefined) => (lat != null && lng != null ? { latitude: lat, longitude: lng } : null);

// Position du livreur pour la carte et le temps restant (sans réseau, la course continue sans elle).
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

// Une course : ramassage, puis livraison, chaque étape validée en glissant.
export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { reload: reloadCurrent, setNotice } = useDriver();
  const queue = useQueue();
  const [order, setOrder] = useState<DriverOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<number[]>([]);
  const me = usePosition();
  const now = useNow();
  const t = useT();

  const load = useCallback(async () => {
    try {
      setOrder(await driverFetch<DriverOrder>(`/orders/${id}`));
      setError(null);
    } catch (e) {
      if (!(e instanceof NetworkError)) setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  // Relue toutes les 8 s et dès qu'une notification arrive : la clôture par le client s'affiche aussitôt.
  useLiveRefresh(load, { every: 8000 });

  if (error) {
    return (
      <div>
        <TopBar title="Course" back="/livreur" />
        <p className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (!order) {
    return (
      <div>
        <TopBar title="Course" back="/livreur" />
        <div className="p-4">
          <Skeleton rows={3} />
        </div>
      </div>
    );
  }

  const status = shownStatus(order, queue);
  const waiting = queue.some((q) => q.orderId === order.id);
  const pickupTitle = order.restaurant?.name ?? order.customerName;
  const pickupAddress = order.restaurant?.address ?? order.pickupAddress ?? "";
  const dropName = order.type === "PARCEL" ? (order.recipientName ?? order.customerName) : order.customerName;
  const dropPhone = order.type === "PARCEL" ? (order.recipientPhone ?? order.customerPhone) : order.customerPhone;
  const pickupMap = order.restaurant ? mapsUrl(order.restaurant.latitude, order.restaurant.longitude, order.restaurant.address) : mapsUrl(order.pickupLatitude, order.pickupLongitude, pickupAddress);
  const dropMap = mapsUrl(order.latitude, order.longitude, order.address);
  // Position envoyée par le destinataire depuis son lien, ou encore attendue.
  const accuracy = order.locationRequest?.accuracyM;
  const dropHint =
    order.locationSource === "RECIPIENT" && order.latitude !== null
      ? accuracy
        ? t("Position GPS du destinataire, à {m} m près", { m: Math.round(accuracy) })
        : t("Position GPS du destinataire")
      : order.locationRequest && order.latitude === null
        ? t("Position du destinataire pas encore reçue : appelez-le")
        : null;
  const restaurantWaiting = order.type === "FOOD" && order.status === "PENDING";

  async function step(next: "PICKED_UP" | "DELIVERED", extra?: { cashCollected?: number; cashNote?: string; code?: string }) {
    setBusy(true);
    try {
      const updated = await sendStep({ orderId: order!.id, status: next, at: new Date().toISOString(), ...extra });
      setSheet(null);
      if (updated) setOrder(updated);
      await reloadCurrent();
      if (next === "DELIVERED") router.push("/livreur");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const done = status === "DELIVERED" || status === "CANCELLED";
  const pickedUp = status === "PICKED_UP" || status === "DELIVERED" || (status === "CANCELLED" && !!order.pickedUpAt);
  // Remise déclarée : le client confirme dans son application, ou donne son code pour clôturer tout de suite.
  const awaitingCustomer = status === "PICKED_UP" && !!order.handedOverAt;

  const from = order.restaurant ? point(order.restaurant.latitude, order.restaurant.longitude) : point(order.pickupLatitude, order.pickupLongitude);
  const to = pickedUp ? point(order.latitude, order.longitude) : null;
  const target = pickedUp ? to : from;
  const left = me && target ? km(me, target) : null;
  // Moto à environ 18 km/h en ville.
  const minutes = left !== null ? Math.max(1, Math.round(left * 3.4)) : null;
  const bar = order.type === "FOOD" ? ["Acceptée", "Au resto", "Récupérée", "Livrée"] : ["Acceptée", "Au départ", "Récupéré", "Livré"];
  const reached = status === "DELIVERED" ? 3 : pickedUp ? 2 : status === "READY" || order.type === "PARCEL" ? 1 : 0;
  const since = (iso: string | null) => {
    const sec = Math.max(0, Math.floor((now - new Date(iso ?? order.createdAt).getTime()) / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };
  const pill = pickedUp
    ? { tone: "bg-emerald-50 text-emerald-800", dot: "bg-emerald-600", text: order.latitude !== null ? t("Position partagée avec le client") : t("Position du client attendue") }
    : order.type === "FOOD" && order.status === "READY"
      ? { tone: "bg-sun-soft text-amber-900", dot: "bg-sun", text: `${t("Au restaurant · attente {time}", { time: since(order.readyAt) })}` }
      : restaurantWaiting
        ? { tone: "bg-stone-100 text-stone-700", dot: "bg-stone-400", text: t("Le restaurant n'a pas encore accepté") }
        : order.type === "FOOD"
          ? { tone: "bg-stone-100 text-stone-700", dot: "bg-stone-400", text: `${t("En préparation")}${order.prepMinutes ? ` · ≈ ${order.prepMinutes} min` : ""}` }
          : { tone: "bg-sun-soft text-amber-900", dot: "bg-sun", text: t("Colis à récupérer") };
  const title = pickedUp ? dropName : pickupTitle;
  const address = pickedUp ? order.address : pickupAddress;
  const phone = pickedUp ? dropPhone : (order.restaurant?.phone ?? order.customerPhone);
  const articles = order.items.reduce((n, it) => n + it.quantity, 0);

  return (
    <div>
      <div className="relative h-[38vh] min-h-[220px] bg-stone-200 [&_.leaflet-bottom]:!bottom-7">
        <LiveMap key={pickedUp ? "drop" : "pickup"} from={from} to={to} driver={me} fromEmoji={order.type === "FOOD" ? "🍗" : "📦"} />
        <div className="absolute inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[500] flex items-center justify-between gap-2">
          <button onClick={() => router.push("/livreur")} aria-label={t("Retour")} className="grid h-11 w-11 place-items-center rounded-full bg-surface shadow">
            <Icon name="back" className="h-5 w-5" />
          </button>
          <span className="truncate rounded-full bg-surface px-4 py-2 text-[15px] font-bold shadow">
            {pickedUp ? t("Livraison") : t("Ramassage")} · {order.code}
          </span>
          <a href={pickedUp ? dropMap : pickupMap} target="_blank" rel="noreferrer" aria-label={t("Itinéraire")} className="grid h-11 w-11 place-items-center rounded-full bg-surface text-emerald-700 shadow">
            <Icon name="map" className="h-5 w-5" />
          </a>
        </div>
      </div>
      <div className="relative z-10 -mt-5 space-y-3 rounded-t-[14px] bg-stone-50 px-4 pb-6 pt-4">
        {order.status === "CANCELLED" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{t("Commande annulée")}{order.cancellationReason ? ` : ${order.cancellationReason}` : ""}. {t("Rapportez-la si vous l'avez déjà récupérée.")}</p>}
        {waiting && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Étape enregistrée sur le téléphone, envoi au retour du réseau.")}</p>}
        {awaitingCustomer && (
          <div className="space-y-3 rounded-xl bg-sky-50 p-4 text-sm text-sky-950">
            <p className="font-semibold">{t("Remise enregistrée à {time}", { time: timeOf(order.handedOverAt) ?? "" })}</p>
            <p>
              {order.receiptDisputedAt
                ? t("Le client dit ne pas avoir reçu la commande. La répartition va vous appeler.")
                : t("En attente de la confirmation du client. Sans réponse, la livraison se clôture seule après 30 min.")}
            </p>
            <CodeForm busy={busy} onSubmit={(code) => step("DELIVERED", { code })} />
          </div>
        )}

        <section aria-label={t("Étapes de la course")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold ${pill.tone}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                <span className="tabular-nums">{pill.text}</span>
              </span>
              <h1 className="mt-2 text-[24px] font-bold leading-tight">{title}</h1>
              <p className="text-[14px] text-stone-600">{address}</p>
              {pickedUp && dropHint && <p className="mt-1 text-sm font-medium text-emerald-700">{dropHint}</p>}
              {!pickedUp && !order.restaurant && order.pickupLatitude !== null && <p className="mt-1 text-sm font-medium text-emerald-700">{t("Position GPS donnée par l'expéditeur")}</p>}
            </div>
            {pickedUp && minutes !== null ? (
              <div className="shrink-0 rounded-[10px] border border-stone-200 bg-surface px-3 py-2 text-center">
                <p className="text-[22px] font-bold leading-none">
                  {minutes} <span className="text-[13px] font-medium">min</span>
                </p>
                <p className="mt-1 text-[12px] text-stone-500">{t("{km} km", { km: left!.toFixed(1).replace(".", ",") })}</p>
              </div>
            ) : (
              phone &&
              !pickedUp && (
                <a href={tel(phone)} aria-label={order.restaurant ? t("Appeler le restaurant") : t("Appeler l'expéditeur")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
                  <Icon name="phone" className="h-5 w-5" />
                </a>
              )
            )}
          </div>
          <div className="mt-3 flex gap-1" aria-hidden="true">
            {bar.map((l, i) => (
              <span key={l} className={`h-1.5 flex-1 rounded-full ${i < reached ? "bg-emerald-600" : i === reached ? "step-now" : "bg-stone-200"}`} />
            ))}
          </div>
          <div className="mt-1 flex gap-1 text-[11px]">
            {bar.map((l, i) => (
              <span key={l} aria-current={i === reached ? "step" : undefined} className={`flex-1 ${i === reached ? "font-semibold text-stone-900" : "text-stone-400"}`}>
                {t(l)}
              </span>
            ))}
          </div>
        </section>

        {order.type === "FOOD" && !pickedUp && !done && (
          <section className={`${card} p-4`}>
            <p className="font-bold">{t("À vérifier ({n} articles)", { n: articles })}</p>
            <ul className="mt-2 space-y-2">
              {order.items.map((it, i) => (
                <li key={i}>
                  <label className="flex items-center gap-3 text-[15px]">
                    <input type="checkbox" checked={checked.includes(i)} onChange={() => setChecked((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))} className="h-5 w-5 accent-emerald-600" />
                    {it.quantity}× {it.name}
                    {it.variantName ? ` (${it.variantName})` : ""}
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
        {order.type === "PARCEL" && !pickedUp && (
          <section className={`${card} grid grid-cols-3 gap-2 p-4 text-[13px]`}>
            <p>
              <span className="block text-stone-500">{t("Type")}</span>
              <span className="font-semibold">{order.parcelCategory?.name ? t(order.parcelCategory.name) : "–"}</span>
            </p>
            <p>
              <span className="block text-stone-500">{t("Poids")}</span>
              <span className="font-semibold">{order.weightKg ? `${order.weightKg} kg` : "–"}</span>
            </p>
            <p>
              <span className="block text-stone-500">{t("Taille")}</span>
              <span className="font-semibold">{order.parcelSize ? t({ SMALL: "petit", MEDIUM: "moyen", LARGE: "grand" }[order.parcelSize]) : "–"}</span>
            </p>
          </section>
        )}

        {order.note && <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{t("Note du client :")} {order.note}</p>}

        {pickedUp ? (
          <>
            <section className={`${card} p-4`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{order.cashDue ? (order.payer === "RECIPIENT" ? t("À encaisser auprès du destinataire") : t("À encaisser")) : t("Paiement")}</span>
                <span className="text-[24px] font-bold">{order.cashDue ? fcfa(order.cashDue) : t("Déjà payé")}</span>
              </div>
              {order.cashDue > 0 && (
                <p className="mt-1 text-[13px] text-stone-500">
                  {t("Espèces")}
                  {order.promoCode && (order.discount ?? 0) > 0 ? ` · ${t("remise {code} déjà déduite", { code: order.promoCode })}` : ""}
                </p>
              )}
            </section>
            {!done && (
              <div className="grid grid-cols-2 gap-2">
                <a href={tel(dropPhone)} className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-sun px-4 py-3 font-bold text-ink-deep">
                  <Icon name="phone" className="h-5 w-5" /> {t("Client")}
                </a>
                <button onClick={() => setSheet("issue")} className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-red-300 bg-surface px-4 py-3 font-bold text-red-700">
                  ⚠ {t("Un problème ?")}
                </button>
              </div>
            )}
          </>
        ) : (
          !done && (
            // Étape suivante, verrouillée : l'adresse et le contact du client s'affichent après le ramassage.
            <section className="flex items-start gap-3 rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-500">
              <Icon name="lock" className="mt-1 h-5 w-5 shrink-0" />
              <p>
                <span className="block font-semibold text-stone-600">{t("Livraison")}</span>
                {t("L'adresse et le contact du client s'afficheront une fois la commande récupérée.")}
              </p>
            </section>
          )
        )}

        {!done && !awaitingCustomer && (
          <div className="space-y-3 pt-2">
            {!pickedUp ? (
              <>
                {restaurantWaiting && <p className="text-center text-sm text-stone-500">{t("Attendez que le restaurant accepte la commande.")}</p>}
                <SwipeButton label="Glisser : commande récupérée" disabled={busy || restaurantWaiting} onConfirm={() => step("PICKED_UP")} />
                <button onClick={() => setSheet("issue")} className="w-full py-2 text-center font-medium text-red-700">
                  {t("Un problème ?")}
                </button>
              </>
            ) : (
              <SwipeButton label="Glisser : commande livrée" disabled={busy} onConfirm={() => setSheet("handover")} />
            )}
          </div>
        )}
        {order.cashCollected !== null && (
          <p className="text-center text-sm text-stone-600">
            {t("Reçu :")} {fcfa(order.cashCollected)}
            {order.cashNote ? ` · ${order.cashNote}` : ""}
          </p>
        )}
      </div>

      {sheet === "handover" && <HandoverSheet due={order.cashDue} busy={busy} onCancel={() => setSheet(null)} onConfirm={(c) => step("DELIVERED", c)} />}
      {sheet === "issue" && <IssueSheet orderId={order.id} onClose={() => setSheet(null)} />}
    </div>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <DialogBox onClose={onClose} aria-label={t(title)} onClick={(e) => e.stopPropagation()} className="mx-auto w-full max-w-md space-y-4 rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <span aria-hidden="true" className="mx-auto mb-2 block h-[5px] w-9 shrink-0 rounded-full bg-stone-300 sm:hidden" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t(title)}</h2>
          <button onClick={onClose} aria-label={t("Fermer")} className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </DialogBox>
    </div>
  );
}

// Code à 4 chiffres affiché dans le suivi du client.
function CodeForm({ busy, onSubmit }: { busy: boolean; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  const t = useT();
  const ok = /^\d{4}$/.test(code);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(code);
      }}
    >
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="0000" aria-label={t("Code du client")} className={`${input} flex-1 text-center text-xl font-bold tracking-[0.4em]`} />
      <button disabled={busy || !ok} className="shrink-0 rounded-xl bg-[#0a6a3f] px-4 font-semibold text-white disabled:opacity-50">
        {t("Clôturer")}
      </button>
    </form>
  );
}

// Remise au client : espèces reçues (un écart demande une explication), puis code du client ou confirmation
// laissée au client dans son application.
function HandoverSheet({ due, busy, onCancel, onConfirm }: { due: number; busy: boolean; onCancel: () => void; onConfirm: (c: { cashCollected?: number; cashNote?: string; code?: string }) => void }) {
  const [amount, setAmount] = useState(String(due));
  const [note, setNote] = useState("");
  const [code, setCode] = useState("");
  const t = useT();
  const value = Number(amount.replace(/\D/g, ""));
  const differs = due > 0 && amount !== "" && value !== due;
  const cashReady = due === 0 || (amount !== "" && (!differs || note.trim().length >= 3));
  const cash = due ? { cashCollected: value, ...(differs ? { cashNote: note } : {}) } : {};
  const codeOk = /^\d{4}$/.test(code);
  return (
    <BottomSheet title="Remise au client" onClose={onCancel}>
      {due > 0 && (
        <>
          <p className="text-sm text-stone-600">
            {t("Le client doit payer")} <strong>{fcfa(due)}</strong>. {t("Indiquez ce que vous avez reçu.")}
          </p>
          <label className="block text-sm font-medium">
            {t("Montant reçu (FCFA)")}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" aria-label={t("Montant reçu")} className={`${input} mt-1 text-xl font-bold`} />
          </label>
          {differs && (
            <label className="block text-sm font-medium text-red-700">
              {t("Pourquoi ce montant est-il différent ?")}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Ex. le client n'avait pas la monnaie")} aria-label={t("Raison de l'écart")} className={`${input} mt-1`} />
            </label>
          )}
        </>
      )}
      <label className="block text-sm font-medium">
        {t("Code du client (4 chiffres)")}
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="0000" aria-label={t("Code du client")} className={`${input} mt-1 text-center text-xl font-bold tracking-[0.4em]`} />
      </label>
      <p className="text-xs text-stone-500">{t("Le client voit ce code dans son suivi. Sans code, il confirmera la réception dans son application.")}</p>
      <button disabled={busy || !cashReady || !codeOk} onClick={() => onConfirm({ ...cash, code })} className={primary}>
        {t("Clôturer avec le code")}
      </button>
      <button disabled={busy || !cashReady} onClick={() => onConfirm(cash)} className={secondary}>
        {t("Remise faite, le client confirmera")}
      </button>
    </BottomSheet>
  );
}

function IssueSheet({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [kind, setKind] = useState<string>("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  async function send() {
    setState("busy");
    setError(null);
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      if (!("geolocation" in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), { timeout: 5000, maximumAge: 60_000 });
    });
    try {
      await driverFetch("/issues", {
        method: "POST",
        body: { orderId, kind, note: note || undefined, ...(position ? { latitude: position.coords.latitude, longitude: position.coords.longitude } : {}) },
      });
      setState("sent");
    } catch (e) {
      setError(e instanceof NetworkError ? t("Pas de réseau : appelez la répartition.") : (e as Error).message);
      setState("idle");
    }
  }

  return (
    <BottomSheet title="Un problème ?" onClose={onClose}>
      {state === "sent" ? (
        <>
          <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{t("La répartition est prévenue et va vous rappeler. Restez joignable.")}</p>
          <button onClick={onClose} className={primary}>
            {t("Fermer")}
          </button>
        </>
      ) : (
        <>
          <div className="space-y-2">
            {ISSUE_KINDS.map((k) => (
              <label key={k.value} className={`flex items-center gap-3 rounded-xl border p-3 ${kind === k.value ? "border-red-500 bg-red-50" : "border-stone-200"}`}>
                <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
                {t(k.label)}
              </label>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t("Détails (facultatif)")} aria-label={t("Détails du problème")} className={input} />
          {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <button disabled={!kind || state === "busy"} onClick={send} className="inline-flex w-full items-center justify-center rounded-xl bg-red-600 px-4 py-3 font-semibold text-white disabled:opacity-50">
            {state === "busy" ? t("Envoi…") : t("Prévenir la répartition")}
          </button>
        </>
      )}
    </BottomSheet>
  );
}
