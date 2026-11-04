"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { readDetails, type OrderDetails } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

const SIZE = { SMALL: "Petit", MEDIUM: "Moyen", LARGE: "Grand" } as const;

// Même découpage que le formulaire d'envoi (classes de poids).
function weightLabel(kg: number) {
  if (kg < 1) return "Moins de 1 kg";
  if (kg <= 5) return "1 à 5 kg";
  if (kg <= 10) return "5 à 10 kg";
  if (kg <= 20) return "10 à 20 kg";
  return "Plus de 20 kg";
}

// Tout ce qui a été saisi à la commande, sur la page de suivi : départ et arrivée, destinataire (numéro masqué),
// position confirmée ou non, type, poids, taille, note et qui paie. Visible seulement par qui a commandé.
export default function DeliveryDetails({ code, parcel, stamp }: { code: string; parcel: boolean; stamp: string }) {
  const t = useT();
  const [d, setD] = useState<OrderDetails | null>(null);

  useEffect(() => {
    readDetails(code).then(setD).catch(() => setD(null));
  }, [code, stamp]);

  if (!d) return null;
  const facts = parcel
    ? [
        d.category && { label: t("Type"), value: d.category },
        d.weightKg != null && { label: t("Poids"), value: t(weightLabel(d.weightKg)) },
        d.parcelSize && { label: t("Taille"), value: t(SIZE[d.parcelSize]) },
        d.payer && { label: t("Qui paie"), value: d.payer === "RECIPIENT" ? t("Le destinataire, à la livraison") : t("L'expéditeur") },
      ].filter(Boolean)
    : [];

  return (
    <section className="space-y-4 rounded-[20px] bg-white p-5">
      <h2 className="text-[17px] font-semibold">{parcel ? t("Le colis") : t("Livraison")}</h2>
      <ol className="space-y-3">
        {parcel && (
          <li className="flex gap-3">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-emerald-600 ring-4 ring-emerald-600/15" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="block text-[12px] uppercase tracking-wide text-stone-500">{t("Expéditeur")}</span>
              <span className="block font-semibold">{d.sender.name}</span>
              <span className="block text-stone-500">{d.sender.phone}</span>
              {d.pickupAddress && <span className="block text-stone-600">{d.pickupAddress}</span>}
            </span>
          </li>
        )}
        <li className="flex gap-3">
          <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-coral" />
          <span className="min-w-0 flex-1 text-sm">
            <span className="block text-[12px] uppercase tracking-wide text-stone-500">{parcel ? t("Destinataire") : t("Livrer à")}</span>
            {d.recipient && <span className="block font-semibold">{d.recipient.name}</span>}
            {d.recipient?.phone && <span className="block text-stone-500">{d.recipient.phone}</span>}
            <span className="block text-stone-600">{d.address ?? t("Adresse donnée par le destinataire")}</span>
            {d.locationSource === "RECIPIENT" && (
              <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] font-medium text-emerald-700">
                <Icon name="check" className="h-3.5 w-3.5" /> {t("Position confirmée par le destinataire")}
              </span>
            )}
          </span>
        </li>
      </ol>
      {(d.distanceKm != null || d.driverPlate) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-stone-500">
          {d.distanceKm != null && <span>{t("{km} km de trajet", { km: d.distanceKm.toFixed(1).replace(".", ",") })}</span>}
          {d.driverPlate && (
            <span>
              {t("Plaque")} <span className="rounded-md bg-sun px-1.5 py-0.5 font-mono font-bold text-ink">{d.driverPlate}</span>
            </span>
          )}
        </p>
      )}
      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          {facts.map((f) => f && (
            <div key={f.label} className="rounded-xl bg-stone-50 px-3 py-2">
              <dt className="text-[12px] text-stone-500">{f.label}</dt>
              <dd className="text-sm font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {d.note && <p className="rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-700">« {d.note} »</p>}
    </section>
  );
}
