"use client";

import Link from "next/link";
import { useEffect } from "react";
import { InstallPrompt } from "@/components/AppRuntime";
import OrderCode from "@/components/OrderCode";
import { fcfa, type CreatedOrder } from "@/lib/api";
import { rememberOrder, type RecentOrder } from "@/lib/device";
import { useT } from "@/lib/i18n/client";

type Props = { order: CreatedOrder; trackHref?: string; label?: string; kind?: RecentOrder["kind"]; priceNote?: string };

// priceNote remplace le total quand le prix n'est pas encore fixé (colis en attente de la position du destinataire).
export default function OrderCreated({ order, trackHref, label = "Commande", kind = "FOOD", priceNote }: Props) {
  // Gardée sur l'appareil pour la suivre depuis l'application, même sans compte.
  useEffect(() => rememberOrder(kind, order.code), [kind, order.code]);
  const t = useT();
  const booking = label !== "Commande";

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold">{booking ? t("{label} enregistrée", { label: t(label) }) : t("Commande enregistrée")}</h2>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">{t("Votre code de suivi")}</p>
          <OrderCode code={order.code} />
        </div>
        <p className="text-stone-700">
          {priceNote ?? (
            <>
              {t("Total à payer :")} <strong>{fcfa(order.total)}</strong>.
            </>
          )}{" "}
          {booking
            ? t("Envoyez-nous la réservation sur WhatsApp pour qu'elle soit traitée tout de suite.")
            : t("Envoyez-nous la commande sur WhatsApp pour qu'elle soit traitée tout de suite.")}
        </p>
        <a
          href={order.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-lg bg-emerald-600 px-4 py-3 text-center font-semibold text-white"
        >
          {t("Envoyer sur WhatsApp")}
        </a>
        <Link href={trackHref ?? `/commande/${order.code}`} className="block text-center text-sm text-emerald-700 underline">
          {booking ? t("Suivre ma réservation") : t("Suivre ma commande")}
        </Link>
      </div>
      <InstallPrompt />
    </div>
  );
}
