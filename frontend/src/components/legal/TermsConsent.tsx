"use client";

import { useT } from "@/lib/i18n/client";

// Case obligatoire avant une commande, un colis, une inscription ou une candidature : conditions et confidentialité.
// Jamais cochée d'avance ; l'API refuse l'envoi sans elle et garde l'heure de l'accord.
export default function TermsConsent({
  terms = { href: "/conditions", label: "conditions générales" },
  checked,
  onChange,
  className = "",
  id,
  invalid = false,
  children,
}: {
  id?: string;
  invalid?: boolean;
  terms?: { href: string; label: string };
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className={`space-y-2 ${className}`}>
      <label className={`flex items-start gap-3 text-sm text-stone-800 ${invalid ? "rounded-lg ring-2 ring-red-600 ring-offset-2" : ""}`}>
        <input
          id={id}
          aria-invalid={invalid || undefined}
          type="checkbox"
          name="acceptTerms"
          required
          checked={checked}
          onChange={onChange && ((e) => onChange(e.target.checked))}
          className="mt-1 h-5 w-5 shrink-0 accent-emerald-700"
        />
        <span>
          {t("J'accepte les")}{" "}
          <a href={terms.href} target="_blank" className="text-emerald-800 underline">
            {t(terms.label)}
          </a>{" "}
          {t("et la")}{" "}
          <a href="/confidentialite" target="_blank" className="text-emerald-800 underline">
            {t("politique de confidentialité")}
          </a>
          .
        </span>
      </label>
      {children && <div className="pl-[1.875rem] text-xs text-stone-600">{children}</div>}
    </div>
  );
}

// Accord sans case à cocher, pour les commandes et les colis : une phrase sous le bouton, le geste de commander vaut
// accord (l'API reçoit acceptTerms et garde l'heure). La case reste pour l'inscription et les candidatures.
export function TermsNotice({ action = "commandant", className = "" }: { action?: "commandant" | "envoyant"; className?: string }) {
  const t = useT();
  return (
    <p className={`text-center text-[12px] text-stone-500 ${className}`}>
      {action === "envoyant" ? t("En envoyant, vous acceptez les") : t("En commandant, vous acceptez les")}{" "}
      <a href="/conditions" target="_blank" className="underline">
        {t("conditions générales")}
      </a>{" "}
      {t("et la")}{" "}
      <a href="/confidentialite" target="_blank" className="underline">
        {t("politique de confidentialité")}
      </a>
      .
    </p>
  );
}

// Délai d'annulation gratuite et frais retenus ensuite (réglages de l'admin), rappelés sous la case avant de commander.
export type Cancellation = { freeCancellationMinutes: number; cancellationFeePercent: number };

export function CancellationNote({ freeCancellationMinutes, cancellationFeePercent }: Cancellation) {
  const t = useT();
  return <>{t("Annulation gratuite pendant {minutes} min, tant que la préparation ou le ramassage n'a pas commencé. Ensuite, {percent} % des frais de livraison sont retenus sur un paiement déjà fait ; en espèces à la livraison, rien n'est dû.", { minutes: freeCancellationMinutes, percent: cancellationFeePercent })}</>;
}
