"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { COMPANY, LEGAL_LINKS } from "@/lib/legal";

// En-tête du site public ; l'application client, l'application livreur, l'admin, l'espace restaurant et l'espace loueur ont leur propre cadre.
export default function PublicChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const panel = /^\/(admin|restaurant|location)(\/|$)/.test(pathname) && !pathname.endsWith("/connexion");
  if (panel || /^\/(app|livreur)(\/|$)/.test(pathname)) return <>{children}</>;
  // Carte d'un restaurant, caisse et colis prennent toute la largeur sur ordinateur.
  const width = /^\/(r|colis)(\/|$)/.test(pathname) ? "max-w-6xl" : "max-w-2xl";
  // Laisse la place à la barre de validation fixée en bas sur téléphone.
  const bottomBar = /^\/(r|louer)\/.+/.test(pathname);

  return (
    <>
      <header className="bg-emerald-600 text-white">
        <div className={`mx-auto flex ${width} items-center justify-between px-4 py-3`}>
          <Link href="/" aria-label="Zedeka, accueil">
            <Logo size="sm" tone="light" />
          </Link>
          <span className="flex items-center gap-4 text-sm">
            <Link href="/suivi" className="opacity-90">
              <span className="sm:hidden">Suivi</span>
              <span className="hidden sm:inline">Suivre une commande</span>
            </Link>
            <Link href="/app" className="font-medium">
              Mon espace
            </Link>
          </span>
        </div>
      </header>
      <main className={`mx-auto ${width} px-4 py-6`}>{children}</main>
      <footer className={`border-t border-stone-200 ${bottomBar ? "pb-28 lg:pb-6" : "pb-6"}`}>
        <div className={`mx-auto ${width} space-y-2 px-4 pt-4 text-xs text-stone-500`}>
          <nav aria-label="Informations légales" className="flex flex-wrap gap-x-4 gap-y-1">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="underline">
                {l.label}
              </Link>
            ))}
          </nav>
          <p>
            © {new Date().getFullYear()} {COMPANY.brand} · Lomé, Togo
          </p>
        </div>
      </footer>
    </>
  );
}
