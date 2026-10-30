"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { card, input, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch, ISSUE_KINDS, mapsUrl, NetworkError, sendStep, shownStatus, tel, timeOf, useQueue, type DriverOrder } from "@/lib/driver";
import { useDriver } from "../../DriverShell";
import SwipeButton from "../../SwipeButton";
import { useT } from "@/lib/i18n/client";

type Sheet = "cash" | "issue" | null;

function Place({ label, title, address, hint, phone, phoneLabel, map, time }: { label: string; title: string; address: string; hint?: string | null; phone?: string | null; phoneLabel: string; map: string; time?: string | null }) {
  const t = useT();
  return (
    <section className={`${card} p-4`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t(label)}</p>
        {time && <p className="text-xs text-emerald-700">✓ {time}</p>}
      </div>
      <p className="mt-1 text-lg font-semibold">{title}</p>
      <p className="text-stone-600">{address}</p>
      {hint && <p className="mt-1 text-sm font-medium text-emerald-700">{t(hint)}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {phone && (
          <a href={tel(phone)} className={secondary}>
            <Icon name="phone" className="h-5 w-5" /> {t(phoneLabel)}
          </a>
        )}
        <a href={map} target="_blank" rel="noreferrer" className={secondary}>
          <Icon name="map" className="h-5 w-5" /> {t("Itinéraire")}
        </a>
      </div>
    </section>
  );
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
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

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

  async function step(next: "PICKED_UP" | "DELIVERED", cash?: { cashCollected: number; cashNote?: string }) {
    setBusy(true);
    try {
      const updated = await sendStep({ orderId: order!.id, status: next, at: new Date().toISOString(), ...cash });
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

  return (
    <div>
      <TopBar title={`${order.code} · ${order.type === "FOOD" ? t("Repas") : t("Colis")}`} back="/livreur" />
      <div className="space-y-3 px-4 py-4">
        {order.status === "CANCELLED" && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{t("Commande annulée")}{order.cancellationReason ? ` : ${order.cancellationReason}` : ""}. {t("Rapportez-la si vous l'avez déjà récupérée.")}</p>}
        {waiting && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Étape enregistrée sur le téléphone, envoi au retour du réseau.")}</p>}

        <ol className="flex items-center gap-2 text-xs font-semibold">
          {[
            ["Ramassage", status !== "PICKED_UP" && !done],
            ["Livraison", status === "PICKED_UP"],
            ["Livrée", status === "DELIVERED"],
          ].map(([label, on], i) => (
            <li key={String(label)} className={`flex-1 rounded-full px-2 py-1.5 text-center ${on ? "bg-emerald-700 text-white" : "bg-stone-200 text-stone-600"}`}>
              {i + 1}. {t(String(label))}
            </li>
          ))}
        </ol>

        <Place label="Ramassage" title={pickupTitle} address={pickupAddress} hint={!order.restaurant && order.pickupLatitude !== null ? t("Position GPS donnée par l'expéditeur") : null} phone={order.restaurant?.phone ?? order.customerPhone} phoneLabel={order.restaurant ? "Restaurant" : "Expéditeur"} map={pickupMap} time={timeOf(order.pickedUpAt)} />

        {order.type === "FOOD" && status !== "PICKED_UP" && !done && (
          <section className={`${card} p-4 text-sm`}>
            <p className="font-semibold">
              {order.status === "READY" ? t("Commande prête au restaurant") : restaurantWaiting ? t("Le restaurant n'a pas encore accepté") : `${t("En préparation")}${order.prepMinutes ? ` (≈ ${order.prepMinutes} min)` : ""}`}
            </p>
            <ul className="mt-2 space-y-1 text-stone-700">
              {order.items.map((it, i) => (
                <li key={i}>
                  {it.quantity} × {it.name}
                  {it.variantName ? ` (${it.variantName})` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-stone-500">{t("Vérifiez le nombre d'articles avant de partir.")}</p>
          </section>
        )}
        {order.type === "PARCEL" && (
          <p className="px-1 text-sm text-stone-600">
            {t("Colis :")} {order.parcelCategory?.name ? t(order.parcelCategory.name) : "–"}
            {order.weightKg ? `, ${order.weightKg} kg` : ""}
            {order.parcelSize ? `, ${t({ SMALL: "petit", MEDIUM: "moyen", LARGE: "grand" }[order.parcelSize])}` : ""}
          </p>
        )}

        <Place label="Livraison" title={dropName} address={`${order.address} · ${order.zone.name.split(" (")[0]}`} hint={dropHint} phone={dropPhone} phoneLabel="Client" map={dropMap} time={timeOf(order.deliveredAt)} />
        {order.note && <p className="rounded-xl bg-stone-100 p-3 text-sm text-stone-700">{t("Note du client :")} {order.note}</p>}

        <section className={`${card} flex items-center justify-between p-4`}>
          <span className="text-sm text-stone-600">{order.cashDue ? (order.payer === "RECIPIENT" ? t("À encaisser auprès du destinataire") : t("À encaisser en espèces")) : t("Paiement")}</span>
          <span className="text-xl font-bold">{order.cashDue ? fcfa(order.cashDue) : t("Déjà payé")}</span>
        </section>

        {!done && (
          <div className="space-y-3 pt-2">
            {status !== "PICKED_UP" ? (
              <>
                {restaurantWaiting && <p className="text-center text-sm text-stone-500">{t("Attendez que le restaurant accepte la commande.")}</p>}
                <SwipeButton label="Glisser : commande récupérée" disabled={busy || restaurantWaiting} onConfirm={() => step("PICKED_UP")} />
              </>
            ) : (
              <SwipeButton label="Glisser : commande livrée" disabled={busy} onConfirm={() => (order.cashDue ? setSheet("cash") : step("DELIVERED"))} />
            )}
            <button onClick={() => setSheet("issue")} className="w-full py-2 text-center font-medium text-red-700">
              {t("Un problème ?")}
            </button>
          </div>
        )}
        {order.cashCollected !== null && (
          <p className="text-center text-sm text-stone-600">
            {t("Reçu :")} {fcfa(order.cashCollected)}
            {order.cashNote ? ` · ${order.cashNote}` : ""}
          </p>
        )}
      </div>

      {sheet === "cash" && <CashSheet due={order.cashDue} busy={busy} onCancel={() => setSheet(null)} onConfirm={(c) => step("DELIVERED", c)} />}
      {sheet === "issue" && <IssueSheet orderId={order.id} onClose={() => setSheet(null)} />}
    </div>
  );
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div role="dialog" aria-label={t(title)} onClick={(e) => e.stopPropagation()} className="mx-auto w-full max-w-md space-y-4 rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{t(title)}</h2>
          <button onClick={onClose} aria-label={t("Fermer")} className="grid h-9 w-9 place-items-center rounded-full hover:bg-stone-100">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Espèces reçues : le total est proposé, un écart demande une explication.
function CashSheet({ due, busy, onCancel, onConfirm }: { due: number; busy: boolean; onCancel: () => void; onConfirm: (c: { cashCollected: number; cashNote?: string }) => void }) {
  const [amount, setAmount] = useState(String(due));
  const [note, setNote] = useState("");
  const t = useT();
  const value = Number(amount.replace(/\D/g, ""));
  const differs = amount !== "" && value !== due;
  return (
    <BottomSheet title="Espèces reçues" onClose={onCancel}>
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
      <button disabled={busy || amount === "" || (differs && note.trim().length < 3)} onClick={() => onConfirm({ cashCollected: value, ...(differs ? { cashNote: note } : {}) })} className={primary}>
        {t("Confirmer la livraison")}
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
