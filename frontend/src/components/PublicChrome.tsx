"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo, { LogoMark } from "@/components/Logo";
import AppShell from "@/app/app/AppShell";
import { LanguageSwitch, useT } from "@/lib/i18n/client";
import { LEGAL_LINKS } from "@/lib/legal";

// En-tête du site public ; l'application client, l'application livreur, l'admin et l'espace restaurant ont leur propre cadre.
export default function PublicChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  const panel = /^\/(admin|restaurant)(\/|$)/.test(pathname) && !pathname.endsWith("/connexion");
  if (panel || /^\/(app|livreur)(\/|$)/.test(pathname)) return <>{children}</>;
  // Colis et suivi vivent dans le cadre de l'application client (barre du haut et onglets), comme l'accueil.
  if (/^\/(colis|suivi|commande)(\/|$)/.test(pathname)) return <AppShell>{children}</AppShell>;
  // Lien de position reçu par le destinataire d'un colis : le logo seul, sans liens vers le reste du site.
  if (/^\/position(\/|$)/.test(pathname))
    return (
      <>
        <header className="relative flex justify-center px-4 pt-6">
          <Logo size="sm" />
          <LanguageSwitch className="absolute right-4 top-6" />
        </header>
        <main id="contenu" className="mx-auto max-w-md px-4 py-6">{children}</main>
      </>
    );
  // Carte d'un restaurant et caisse prennent toute la largeur sur ordinateur.
  const width = /^\/r(\/|$)/.test(pathname) ? "max-w-6xl" : "max-w-2xl";

  return (
    <>
      <header className="glass hairline-b sticky top-0 z-40">
        <div className={`mx-auto flex ${width} items-center justify-between px-4 py-3`}>
          <Link href="/" aria-label={t("Zedeka, accueil")} className="shrink-0">
            {/* Sur petit écran, le symbole seul laisse la place aux liens et au choix de la langue. */}
            <span className="max-[420px]:hidden">
              <Logo size="sm" />
            </span>
            <LogoMark className="hidden h-8 w-8 max-[420px]:block" />
          </Link>
          <span className="flex items-center gap-4 whitespace-nowrap text-[15px] text-emerald-700 sm:gap-5">
            <Link href="/suivi">
              <span className="sm:hidden">{t("Suivi")}</span>
              <span className="hidden sm:inline">{t("Suivre une commande")}</span>
            </Link>
            <Link href="/app" className="font-semibold">
              {t("Mon espace")}
            </Link>
            <LanguageSwitch />
          </span>
        </div>
      </header>
      <main id="contenu" className={`mx-auto ${width} px-4 py-6`}>{children}</main>
      <footer className="hairline-t mt-6">
        <nav aria-label={t("Informations légales")} className={`mx-auto ${width} px-4 py-5`}>
          <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-stone-600">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="underline-offset-2 hover:underline" aria-current={pathname === l.href ? "page" : undefined}>
                  {t(l.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </footer>
    </>
  );
}
