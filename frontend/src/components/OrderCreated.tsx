"use client";

import Link from "next/link";
import { useEffect } from "react";
import { InstallPrompt } from "@/components/AppRuntime";
import OrderCode from "@/components/OrderCode";
import { fcfa, type CreatedOrder } from "@/lib/api";
import { rememberOrder, type RecentOrder } from "@/lib/device";

type Props = { order: CreatedOrder; trackHref?: string; label?: string; kind?: RecentOrder["kind"]; priceNote?: string };

// priceNote remplace le total quand le prix n'est pas encore fixé (colis en attente de la position du destinataire).
export default function OrderCreated({ order, trackHref, label = "Commande", kind = "FOOD", priceNote }: Props) {
  // Gardée sur l'appareil pour la suivre depuis l'application, même sans compte.
  useEffect(() => rememberOrder(kind, order.code), [kind, order.code]);

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{label} enregistrée</h2>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Votre code de suivi</p>
          <OrderCode code={order.code} />
        </div>
        <p className="text-stone-700">
          {priceNote ?? (
            <>
              Total à payer : <strong>{fcfa(order.total)}</strong>.
            </>
          )}{" "}
          Envoyez-nous {label === "Commande" ? "la commande" : "la réservation"} sur WhatsApp pour
          qu&apos;elle soit traitée tout de suite.
        </p>
        <a
          href={order.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg bg-emerald-600 px-4 py-3 text-center font-semibold text-white"
        >
          Envoyer sur WhatsApp
        </a>
        <Link href={trackHref ?? `/commande/${order.code}`} className="block text-center text-sm text-emerald-700 underline">
          Suivre ma {label === "Commande" ? "commande" : "réservation"}
        </Link>
      </div>
      <InstallPrompt />
    </div>
  );
}
