"use client";

import { askConfirm } from "@/components/AlertDialog";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { card, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import { merchantFetch, type ParcelDetail } from "@/lib/merchant";
import { ParcelStatusPill, shortDate } from "../../ui";

const STEPS = [
  { label: "Envoyé", done: () => true },
  { label: "Ramassé", done: (p: ParcelDetail) => !!p.pickedUpAt || p.status === "DELIVERED" },
  { label: "Livré", done: (p: ParcelDetail) => p.status === "DELIVERED" },
];

// Un colis : étapes, client, argent (encaissé, livraison, ce qui revient à la boutique), messages WhatsApp.
export default function ParcelDetailPage() {
  const t = useT();
  const { locale } = useI18n();
  const router = useRouter();
  const { code } = useParams<{ code: string }>();
  const [p, setP] = useState<ParcelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setP(await merchantFetch<ParcelDetail>(`/parcels/${encodeURIComponent(code)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [code]);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(() => void load(), { every: 15_000, enabled: !!p && p.status !== "DELIVERED" && p.status !== "CANCELLED" });

  async function cancel() {
    if (!(await askConfirm(t("Annuler ce colis ?"), t("Annuler le colis"), { destructive: true, cancelLabel: t("Garder") }))) return;
    setBusy(true);
    try {
      await merchantFetch(`/parcels/${encodeURIComponent(code)}/cancel`, { method: "POST", body: {} });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!p) {
    return (
      <div>
        <TopBar title="Colis" back="/marchand/colis" />
        <div className="p-4">{error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Skeleton rows={3} />}</div>
      </div>
    );
  }

  const waitingPosition = p.locationStatus === "PENDING" || p.locationStatus === "OPENED" || p.locationStatus === "DECLINED";
  return (
    <div>
      <TopBar title={p.code} back="/marchand/colis" />
      <div className="space-y-4 px-4 pb-8 pt-4">
        <section className={`${card} card-line space-y-3 p-4`}>
          <div className="flex items-center justify-between gap-2">
            <h1 className="truncate text-[20px] font-bold">{p.recipientName}</h1>
            <ParcelStatusPill status={p.status} />
          </div>
          {p.status !== "CANCELLED" ? (
            <ol className="flex items-center gap-2">
              {STEPS.map((s, i) => (
                <li key={s.label} className="flex flex-1 flex-col gap-1">
                  <span className={`h-1.5 rounded-full ${s.done(p) ? "bg-emerald-600" : "bg-stone-200"}`} />
                  <span className={`text-[12px] ${s.done(p) ? "font-semibold text-emerald-800" : "text-stone-500"}`}>
                    {i + 1}. {t(s.label)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-stone-600">{p.cancellationReason ?? t("Annulé")}</p>
          )}
          <p className="text-[13px] text-stone-500">
            {t("Envoyé le")} {shortDate(p.createdAt, locale)}
            {p.deliveredAt ? ` · ${t("livré le")} ${shortDate(p.deliveredAt, locale)}` : ""}
          </p>
          {waitingPosition && p.status === "PENDING" && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              {p.locationStatus === "DECLINED" ? t("Le client n'a pas partagé sa position : appelez-le ou contactez Zedeka.") : t("En attente de la position du client (lien WhatsApp).")}
            </p>
          )}
          {p.deliveryCode && (
            <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
              {t("Code de remise à donner au livreur si le client ne l'a pas")} : <strong className="font-mono text-base tracking-widest">{p.deliveryCode}</strong>
            </p>
          )}
          {p.disputed && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{t("Réception contestée : l'équipe Zedeka s'en occupe.")}</p>}
        </section>

        <section className={`${card} card-line divide-y divide-stone-100 px-4`}>
          <Line label="Téléphone" value={p.recipientPhone ?? "–"} />
          <Line label="Livraison" value={p.address} />
          {p.merchantRef && <Line label="N° de commande" value={p.merchantRef} />}
          <Line label="Colis" value={[p.category, p.weightKg !== null ? `${p.weightKg} kg` : null].filter(Boolean).join(" · ") || "–"} />
          {p.driver && <Line label="Livreur" value={`${p.driver.name} · ${p.driver.phone}`} />}
        </section>

        <section className={`${card} card-line divide-y divide-stone-100 px-4`}>
          <Line label="Articles à encaisser" value={p.codAmount ? fcfa(p.codAmount) : t("Déjà payé")} />
          <Line label={p.payer === "RECIPIENT" ? "Livraison (payée par le client)" : "Livraison (payée par la boutique)"} value={fcfa(p.fees)} />
          <Line label="Le livreur encaisse" value={fcfa(p.total)} strong />
          {p.cashCollected !== null && p.cashCollected !== p.total && <Line label="Reçu par le livreur" value={fcfa(p.cashCollected)} />}
          {p.status !== "CANCELLED" && <Line label={p.paidOut ? "Reversé à la boutique" : p.status === "DELIVERED" ? "À recevoir" : "Vous recevrez"} value={fcfa(p.net)} strong />}
        </section>

        {p.status !== "CANCELLED" && (
          <a href={p.message.whatsappUrl} target="_blank" rel="noreferrer" className={secondary}>
            <Icon name="phone" className="h-5 w-5" /> {t("Envoyer le suivi au client sur WhatsApp")}
          </a>
        )}
        {p.recipientPhone && (
          <a href={`tel:${p.recipientPhone.replace(/\s/g, "")}`} className={secondary}>
            {t("Appeler le client")}
          </a>
        )}
        {p.status === "PENDING" && !p.driver && (
          <button type="button" onClick={cancel} disabled={busy} className="w-full rounded-2xl py-3 text-[17px] font-semibold text-red-600 active:bg-red-50">
            {t("Annuler le colis")}
          </button>
        )}
        {p.status === "CANCELLED" && (
          <button type="button" onClick={() => router.push("/marchand/envoyer")} className={primary}>
            {t("Nouvel envoi")}
          </button>
        )}
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const t = useT();
  return (
    <p className="flex justify-between gap-3 py-3 text-[15px]">
      <span className="text-stone-500">{t(label)}</span>
      <span className={`text-right ${strong ? "font-bold" : ""}`}>{value}</span>
    </p>
  );
}
