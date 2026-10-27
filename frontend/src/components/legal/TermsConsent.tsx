// Case obligatoire avant une commande, une réservation ou une candidature ; l'API refuse l'envoi sans elle.
export default function TermsConsent({ terms = { href: "/conditions", label: "conditions générales" }, className = "" }: { terms?: { href: string; label: string }; className?: string }) {
  return (
    <label className={`flex items-start gap-2 text-sm text-stone-700 ${className}`}>
      <input type="checkbox" name="acceptTerms" required className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
      <span>
        J&apos;accepte les{" "}
        <a href={terms.href} target="_blank" className="text-emerald-700 underline">
          {terms.label}
        </a>{" "}
        et la{" "}
        <a href="/confidentialite" target="_blank" className="text-emerald-700 underline">
          politique de confidentialité
        </a>
        .
      </span>
    </label>
  );
}
