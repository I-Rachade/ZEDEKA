"use client";

import Link from "next/link";
import { useHydrated, useStored, writeStored } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { COOKIE_NOTICE_KEY } from "@/lib/legal";

// Bandeau d'information de la première visite. Zedeka n'utilise que des cookies et un stockage nécessaires
// (langue, session, panier) : rien à accepter ni à refuser, donc un seul bouton « Compris », sans case
// pré-cochée ni bouton piège. Il ne bloque pas la page et ne revient plus une fois fermé.
export default function CookieNotice() {
  const t = useT();
  const hydrated = useHydrated();
  const seen = useStored<boolean>(COOKIE_NOTICE_KEY);
  if (!hydrated || seen) return null;
  return (
    <section
      aria-label={t("Cookies")}
      className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[60] mx-auto max-w-md rounded-2xl bg-stone-900 p-4 text-sm text-white shadow-[0_8px_30px_rgb(0_0_0/0.25)] print:hidden"
    >
      <p>
        {t("Zedeka n'utilise que les cookies et le stockage nécessaires au service (langue, session, panier). Aucune publicité, aucun suivi.")}{" "}
        <Link href="/cookies" className="font-semibold text-emerald-300 underline">
          {t("En savoir plus")}
        </Link>
      </p>
      <button
        type="button"
        onClick={() => writeStored(COOKIE_NOTICE_KEY, true)}
        className="mt-3 w-full rounded-xl bg-white px-4 py-2.5 font-semibold text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
      >
        {t("Compris")}
      </button>
    </section>
  );
}
