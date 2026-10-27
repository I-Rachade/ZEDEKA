"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/panel/icons";
import { cartCount, useCart } from "@/lib/cart";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/app", label: "Accueil", icon: "home" },
  { href: "/app/recherche", label: "Recherche", icon: "search" },
  { href: "/app/commandes", label: "Commandes", icon: "orders" },
  { href: "/app/profil", label: "Profil", icon: "user" },
];

// Cadre de l'application client : contenu sur la largeur d'un téléphone, barre d'onglets en bas.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const cart = useCart();
  const count = cartCount(cart);
  const active = (href: string) => (href === "/app" ? pathname === "/app" : pathname.startsWith(href));

  return (
    <div className="mx-auto min-h-screen max-w-md overflow-x-clip bg-stone-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      {children}
      {count > 0 && cart && !pathname.startsWith("/app/connexion") && (
        <Link
          href={`/r/${cart.slug}`}
          className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-3 px-3"
        >
          <span className="anim-slide-up flex w-full items-center gap-3 rounded-2xl bg-emerald-700 px-4 py-3 text-white shadow-lg">
            <span key={count} className="anim-bump grid h-7 min-w-7 place-items-center rounded-lg bg-sun px-1 text-sm font-bold text-ink">{count}</span>
            <span className="flex-1 truncate text-sm">
              Panier · <strong>{cart.name}</strong>
            </span>
            <span className="text-sm font-semibold">Voir</span>
          </span>
        </Link>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map((t) => (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active(t.href) ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-xs ${active(t.href) ? "font-semibold text-emerald-700" : "text-stone-500"}`}
              >
                <span className={`grid h-7 w-12 place-items-center rounded-full transition-colors ${active(t.href) ? "bg-emerald-100" : ""}`}>
                  <Icon name={t.icon} className="h-6 w-6" />
                </span>
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
