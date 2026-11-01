"use client";

import { useT } from "@/lib/i18n/client";
import { MIN_AGE } from "@/lib/legal";

// Case obligatoire avant une commande, un colis, une inscription ou une candidature : âge et conditions.
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
    <div className={`space-y-1.5 ${className}`}>
      <label className={`flex items-start gap-2.5 text-sm text-stone-800 ${invalid ? "rounded-lg ring-2 ring-red-600 ring-offset-2" : ""}`}>
        <input
          id={id}
          aria-invalid={invalid || undefined}
          type="checkbox"
          name="acceptTerms"
          required
          checked={checked}
          onChange={onChange && ((e) => onChange(e.target.checked))}
          className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-700"
        />
        <span>
          {t("J'ai {age} ans ou plus et j'accepte les", { age: MIN_AGE })}{" "}
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

// Délai d'annulation gratuite et frais retenus ensuite (réglages de l'admin), rappelés sous la case avant de commander.
export type Cancellation = { freeCancellationMinutes: number; cancellationFeePercent: number };

export function CancellationNote({ freeCancellationMinutes, cancellationFeePercent }: Cancellation) {
  const t = useT();
  return <>{t("Annulation gratuite pendant {minutes} min, puis {percent} % des frais de livraison retenus.", { minutes: freeCancellationMinutes, percent: cancellationFeePercent })}</>;
}
