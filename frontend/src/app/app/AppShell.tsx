"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/panel/icons";
import { cartCount, useCart } from "@/lib/cart";
import { useT } from "@/lib/i18n/client";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "Accueil", icon: "home" },
  { href: "/app/recherche", label: "Recherche", icon: "search" },
  { href: "/app/commandes", label: "Commandes", icon: "orders" },
  { href: "/app/profil", label: "Profil", icon: "user" },
];

// Cadre de l'application client : contenu sur la largeur d'un téléphone, barre d'onglets en bas.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tr = useT();
  const cart = useCart();
  const count = cartCount(cart);
  // Le colis part de l'accueil ; le suivi d'une commande appartient à « Commandes ».
  const active = (href: string) =>
    href === "/app" ? pathname === "/app" || pathname.startsWith("/colis") : pathname.startsWith(href) || (href === "/app/commandes" && /^\/(suivi|commande)(\/|$)/.test(pathname));

  return (
    <div className="mx-auto min-h-screen max-w-md overflow-x-clip bg-stone-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <main id="contenu">{children}</main>
      {count > 0 && cart && pathname.startsWith("/app") && !pathname.startsWith("/app/connexion") && (
        <Link
          href={`/r/${cart.slug}`}
          className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-3 px-3"
        >
          <span className="glass-dark anim-slide-up flex w-full items-center gap-3 rounded-full py-2.5 pl-2.5 pr-5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
            <span key={count} className="anim-bump grid h-8 min-w-8 place-items-center rounded-full bg-emerald-600 px-1.5 text-sm font-semibold">{count}</span>
            <span className="flex-1 truncate text-sm">
              {tr("Panier")} · <strong>{cart.name}</strong>
            </span>
            <span className="text-sm font-semibold text-emerald-300">{tr("Voir")}</span>
          </span>
        </Link>
      )}
      {/* Barre d'onglets iOS : translucide, icône et libellé teintés pour l'onglet actif, sans pastille. */}
      <nav className="glass hairline-t fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active(t.href) ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium tracking-wide transition-colors ${active(t.href) ? "text-emerald-600" : "text-stone-500"}`}
              >
                <Icon name={t.icon} className="h-[26px] w-[26px]" />
                {tr(t.label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
