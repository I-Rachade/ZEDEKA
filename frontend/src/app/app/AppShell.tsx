"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/panel/icons";
import { cartCount, useCart } from "@/lib/cart";
import { useZedConfig, ZED_COLORS } from "@/lib/zed";
import { RECENT_KEY, useStored, type RecentOrder } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import OngoingPill from "./OngoingPill";

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
  // Bouton rond surélevé au milieu de la barre, toujours là : il ouvre le choix « Envoyer un colis » ou
  // « Une course pour moi » (la course seulement quand le mode Zed est ouvert).
  const { enabled: zed, color } = useZedConfig();
  const look = ZED_COLORS[color];
  const tabs = [...TABS.slice(0, 2), null, ...TABS.slice(2)];
  const [sheet, setSheet] = useState(false);
  const recent = (useStored<RecentOrder[]>(RECENT_KEY) ?? []).filter((r) => r.kind === "PARCEL").slice(0, 2);
  useEffect(() => setSheet(false), [pathname]);
  const zedPage = pathname.startsWith("/app/zed") || pathname.startsWith("/colis");
  // Le suivi d'une commande appartient à « Commandes ».
  const active = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href) || (href === "/app/commandes" && /^\/(suivi|commande)(\/|$)/.test(pathname));

  return (
    <div className="mx-auto min-h-screen max-w-md overflow-x-clip app-bg pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <main id="contenu">{children}</main>
      {count > 0 && cart && pathname.startsWith("/app") && !pathname.startsWith("/app/connexion") && (
        <Link
          href={`/r/${cart.slug}`}
          className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-3 px-3"
        >
          <span className="glass-dark anim-slide-up flex w-full items-center gap-3 rounded-full py-3 pl-3 pr-5 text-white shadow-[0_8px_30px_rgb(0_0_0/0.18)]">
            <span key={count} className="anim-bump grid h-8 min-w-8 place-items-center rounded-full bg-emerald-600 px-2 text-sm font-semibold">{count}</span>
            <span className="flex-1 truncate text-sm">
              {tr("Panier")} · <strong>{cart.name}</strong>
            </span>
            <span className="text-sm font-semibold text-emerald-300">{tr("Voir")}</span>
          </span>
        </Link>
      )}
      {!(count > 0 && cart) && !sheet && (pathname === "/app" || pathname === "/app/recherche") && <OngoingPill />}
      {sheet && (
        <>
          <button type="button" aria-label={tr("Fermer")} onClick={() => setSheet(false)} className="fixed inset-0 z-30 bg-black/35 backdrop-blur-[2px]" />
          <div role="dialog" aria-label={tr("Que voulez-vous faire ?")} className="anim-slide-up fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md px-3">
            <div className="space-y-2 rounded-[12px] bg-white p-4 shadow-[0_-8px_40px_rgb(0_0_0/0.18)]">
              <span className="mx-auto mb-1 block h-1 w-10 rounded-full bg-stone-200" aria-hidden="true" />
              <p className="pb-1 text-[19px] font-bold">{tr("Que voulez-vous faire ?")}</p>
              <ZedChoice href="/colis" emoji="📦" tone="bg-sun-soft" title={tr("Envoyer un colis")} hint={tr("Un livreur récupère et dépose où vous voulez.")} />
              {zed && <ZedChoice href="/app/zed" emoji="🛵" tone="bg-emerald-50" title={tr("Une course pour moi")} hint={tr("Un Zed vient vous chercher là où vous êtes.")} />}
              {recent.length > 0 && (
                <div className="pt-2">
                  <p className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-stone-500">{tr("Refaire")}</p>
                  {recent.map((r) => (
                    <div key={r.code} className="flex items-center gap-3 py-2">
                      <span className="text-[20px]" aria-hidden="true">📦</span>
                      <Link href={`/commande/${r.code}`} className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold">{tr("Colis {code}", { code: r.code })}</span>
                        <span className="block text-[12px] text-stone-500">{new Date(r.at).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
                      </Link>
                      <Link href="/colis" className="rounded-full bg-stone-100 px-3 py-1 text-[13px] font-semibold text-stone-700">
                        {tr("Refaire")}
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
      {/* Barre d'onglets iOS : translucide, icône et libellé teintés pour l'onglet actif, sans pastille. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {tabs.map((t) =>
            t === null ? (
              <li key="zed" className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setSheet((o) => !o)}
                  aria-expanded={sheet}
                  aria-current={zedPage ? "page" : undefined}
                  aria-label={sheet ? tr("Fermer") : tr("Colis ou course Zed")}
                  className={`-mt-6 flex flex-col items-center gap-1 text-[11px] font-semibold transition active:scale-95 ${look.text}`}
                >
                  <span className={`grid h-[60px] w-[60px] place-items-center rounded-full shadow-[0_8px_24px_rgb(0_0_0/0.28)] ring-4 ring-white transition ${sheet ? "bg-ink text-white" : `sheen ${look.button} ${color === "SUN" ? "deep-sun" : color === "GREEN" ? "deep-green" : ""}`}`}>
                    <Icon name={sheet ? "close" : "rider"} className={sheet ? "h-7 w-7" : "h-8 w-8"} />
                  </span>
                  {sheet ? tr("Fermer") : "Zed"}
                </button>
              </li>
            ) : (
              <li key={t.href}>
                <Link
                  href={t.href}
                  aria-current={active(t.href) ? "page" : undefined}
                  className={`flex flex-col items-center gap-1 pb-2 pt-2 text-[11px] font-medium transition-colors ${active(t.href) ? "text-emerald-600" : "text-stone-500"}`}
                >
                  <Icon name={t.icon} className={`h-[26px] w-[26px] ${active(t.href) ? "glow-icon" : ""}`} />
                  {tr(t.label)}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
    </div>
  );
}

// Un des grands choix de la feuille du bouton Zed.
function ZedChoice({ href, emoji, tone, title, hint }: { href: string; emoji: string; tone: string; title: string; hint: string }) {
  return (
    <Link href={href} className="card-gloss flex items-center gap-3 rounded-[12px] p-3 transition active:scale-[0.98]">
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-[10px] text-[28px] ${tone}`} aria-hidden="true">
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        <span className="block text-[13px] leading-snug text-stone-500">{hint}</span>
      </span>
      <Icon name="chevron" className="h-4 w-4 text-stone-300" />
    </Link>
  );
}
