"use client";

import { useState } from "react";
import { fcfa, type Zone } from "@/lib/api";

export const field = "w-full rounded-lg border border-stone-300 bg-white p-3";

type Props = {
  zones: Zone[];
  zoneId: string;
  onZone: (id: string) => void;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  onPayment: (m: "CASH" | "MOBILE_MONEY") => void;
  onPosition?: (p: { latitude: number; longitude: number } | null) => void;
  nameLabel?: string;
  defaultName?: string;
  defaultPhone?: string;
};

// Champs communs aux commandes de repas et de colis : contact, zone, position, paiement.
export default function ContactFields({ zones, zoneId, onZone, paymentMethod, onPayment, onPosition, nameLabel = "Votre nom", defaultName, defaultPhone }: Props) {
  const [position, setPosition] = useState<"idle" | "loading" | "ok" | "error">("idle");

  function locate() {
    if (!navigator.geolocation || !onPosition) return;
    setPosition("loading");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onPosition({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setPosition("ok");
      },
      () => {
        onPosition(null);
        setPosition("error");
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <>
      <input name="name" required minLength={2} placeholder={nameLabel} defaultValue={defaultName} className={field} />
      <input
        name="phone"
        required
        type="tel"
        inputMode="tel"
        pattern="\+?[0-9 ]{8,15}"
        placeholder="Téléphone (ex. 90 00 00 00)"
        defaultValue={defaultPhone}
        className={field}
      />
      <select required value={zoneId} onChange={(e) => onZone(e.target.value)} className={field}>
        <option value="">Choisir la zone de livraison</option>
        {zones.map((z) => (
          <option key={z.id} value={z.id}>
            {z.name} ({z.pricing === "DISTANCE" ? `selon la distance, dès ${fcfa(z.deliveryFee)}` : fcfa(z.deliveryFee)})
          </option>
        ))}
      </select>
      {onPosition && (
        <button type="button" onClick={locate} className="text-left text-sm text-emerald-700 underline">
          {position === "loading"
            ? "Localisation…"
            : position === "ok"
              ? "Position enregistrée ✓"
              : position === "error"
                ? "Position indisponible, réessayer"
                : "Partager ma position (aide le livreur et calcule le tarif)"}
        </button>
      )}
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Paiement</legend>
        <label className="flex items-center gap-2">
          <input type="radio" checked={paymentMethod === "CASH"} onChange={() => onPayment("CASH")} />
          Espèces à la livraison
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={paymentMethod === "MOBILE_MONEY"} onChange={() => onPayment("MOBILE_MONEY")} />
          Mobile money (T-Money ou Flooz)
        </label>
      </fieldset>
    </>
  );
}
