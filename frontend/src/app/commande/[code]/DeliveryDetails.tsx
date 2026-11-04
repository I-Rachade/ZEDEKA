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
// position confirmée ou non, type, poids, taille et note (qui paie est dans le récapitulatif). Visible seulement par qui a commandé.
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
        d.note && { label: t("Note"), value: `« ${d.note} »` },
      ].filter(Boolean)
    : [];
  const km = d.distanceKm;

  return (
    <>
      <section className="card-gloss rounded-[12px] bg-white p-5">
        <ol>
          <li className="relative flex gap-3 pb-4">
            <span className="absolute left-[7px] top-6 h-[calc(100%-1.25rem)] border-l-2 border-dotted border-stone-300" aria-hidden="true" />
            {parcel ? (
              <span className="mt-1 h-4 w-4 shrink-0 rounded-full bg-emerald-600 ring-4 ring-emerald-600/15" aria-hidden="true" />
            ) : (
              <span className="w-4 shrink-0 text-[15px] leading-6" aria-hidden="true">
                🍗
              </span>
            )}
            <span className="min-w-0 flex-1 text-sm">
              <span className="block text-[12px] text-stone-500">{parcel ? t("Expéditeur") : t("Depuis")}</span>
              {parcel ? (
                <>
                  <span className="block font-semibold">{d.sender.name}</span>
                  <span className="block text-[12px] text-stone-500">
                    {d.sender.phone}
                    {d.pickupAddress && ` · ${d.pickupAddress}`}
                  </span>
                </>
              ) : (
                d.from && (
                  <span className="block font-semibold">
                    {d.from.name}
                    {d.from.address && <span className="font-normal text-stone-500"> · {d.from.address}</span>}
                  </span>
                )
              )}
            </span>
          </li>
          <li className="flex gap-3">
            <Icon name="pin" className="mt-1 h-4 w-4 shrink-0 text-coral" />
            <span className="min-w-0 flex-1 text-sm">
              <span className="block text-[12px] text-stone-500">{parcel ? t("Destinataire") : t("Vers")}</span>
              {d.recipient ? <span className="block font-semibold">{d.recipient.name}</span> : <span className="block font-semibold">{d.address ?? t("Adresse donnée par le destinataire")}</span>}
              {d.recipient && (
                <span className="block text-[12px] text-stone-500">
                  {[d.recipient.phone, d.address].filter(Boolean).join(" · ")}
                  {d.locationSource === "RECIPIENT" && (
                    <span className="font-medium text-emerald-700">
                      {" "}· ✓ {t("position confirmée par lien")}
                    </span>
                  )}
                </span>
              )}
            </span>
          </li>
        </ol>
        {km != null && (
          <p className="mt-3 text-[13px] text-stone-600">
            🧭 {t("{km} km · environ {min} min de trajet", { km: km.toFixed(1).replace(".", ","), min: Math.max(2, Math.round(km * 3.4)) })}
          </p>
        )}
      </section>
      {facts.length > 0 && (
        <section className="card-gloss space-y-3 rounded-[12px] bg-white p-5">
          <h2 className="text-[17px] font-semibold">{t("Le colis")}</h2>
          <dl className="grid grid-cols-2 gap-2">
            {facts.map(
              (f) =>
                f && (
                  <div key={f.label} className="rounded-xl bg-stone-50 px-3 py-2">
                    <dt className="text-[12px] text-stone-500">{f.label}</dt>
                    <dd className="text-sm font-semibold">{f.value}</dd>
                  </div>
                ),
            )}
          </dl>
        </section>
      )}
    </>
  );
}
