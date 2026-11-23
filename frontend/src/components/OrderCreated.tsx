"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import OrderCode from "@/components/OrderCode";
import { fcfa, type CreatedOrder } from "@/lib/api";
import { rememberOrder, type RecentOrder } from "@/lib/device";
import { useT } from "@/lib/i18n/client";

// stay : le client a encore quelque chose à faire ici (lien à envoyer au destinataire) : pas d'ouverture automatique du suivi.
type Props = { order: CreatedOrder; trackHref?: string; label?: string; kind?: RecentOrder["kind"]; priceNote?: string; stay?: boolean };

// Temps pendant lequel la coche reste à l'écran avant l'ouverture du suivi.
const REDIRECT_MS = 3500;

// Confirmation qui rassure : grande coche animée, une phrase, l'heure ou le prix, puis le suivi s'ouvre tout seul.
// Plus rien à faire de la part du client (la commande part directement au restaurant ou aux livreurs).
// priceNote remplace le total quand le prix n'est pas encore fixé (colis en attente de la position du destinataire).
export default function OrderCreated({ order, trackHref, label = "Commande", kind = "FOOD", priceNote, stay = false }: Props) {
  // Gardée sur l'appareil pour la suivre depuis l'application, même sans compte.
  useEffect(() => rememberOrder(kind, order.code), [kind, order.code]);
  const t = useT();
  const router = useRouter();
  const href = trackHref ?? `/commande/${order.code}`;
  const parcel = kind === "PARCEL";
  const booking = label !== "Commande";

  useEffect(() => {
    if (stay) return;
    const timer = setTimeout(() => router.push(href), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [router, href, stay]);

  return (
    <div className="mx-auto max-w-md space-y-5 py-6 text-center">
      <div className="anim-pop mx-auto grid h-28 w-28 place-items-center rounded-full bg-emerald-600 text-white shadow-[0_0_0_14px_rgb(5_150_105/0.12),0_0_0_30px_rgb(5_150_105/0.06)]">
        <svg viewBox="0 0 24 24" className="h-14 w-14" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" className="anim-draw" pathLength={1} />
        </svg>
      </div>
      <div className="anim-fade-up space-y-2">
        <h2 className="text-[30px] font-bold leading-tight">{parcel ? t("C'est envoyé !") : booking ? t("{label} enregistrée", { label: t(label) }) : t("C'est commandé !")}</h2>
        <p className="text-[17px] text-stone-600">
          {parcel ? t("Nous cherchons le livreur le plus proche. Vous êtes prévenu dès qu'il accepte.") : t("Votre commande est partie. Vous êtes prévenu à chaque étape.")}
        </p>
      </div>
      <div className="anim-fade-up rounded-2xl bg-surface p-4 text-left shadow-sm">
        <p className="text-xs uppercase tracking-wide text-stone-500">{t("Votre code de suivi")}</p>
        <OrderCode code={order.code} />
        <p className="mt-2 text-[15px] text-stone-700">
          {priceNote ?? (
            <>
              {t("Total à payer :")} <strong>{fcfa(order.total)}</strong>
            </>
          )}
        </p>
      </div>
      <div className="space-y-2">
        {!stay && (
          <div className="h-1.5 overflow-hidden rounded-full bg-stone-200" aria-hidden="true">
            <div className="anim-progress h-full rounded-full bg-emerald-600" style={{ animationDuration: `${REDIRECT_MS}ms` }} />
          </div>
        )}
        <Link href={href} className="block rounded-2xl bg-emerald-600 px-4 py-4 text-[17px] font-semibold text-white active:scale-[0.98]">
          {parcel || booking ? t("Suivre maintenant") : t("Suivre ma commande")}
        </Link>
      </div>
    </div>
  );
}
