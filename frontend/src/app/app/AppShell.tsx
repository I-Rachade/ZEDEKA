"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/panel/icons";
import { cartCount, useCart } from "@/lib/cart";
import { ZED_COLORS } from "@/lib/zed";
import { moduleOn, useModuleText, useServices, type ServiceModule } from "@/lib/services";
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
  // Bouton « Services » surélevé au milieu de la barre (carré aux coins arrondis). Il ouvre la feuille des modules
  // activés dans l'admin : colis et course Zed en haut, puis les autres services (« Bientôt » s'ils sont annoncés).
  // Aucun module visible : pas de bouton, la barre garde ses quatre onglets.
  const services = useServices();
  const text = useModuleText();
  const look = ZED_COLORS[services.color];
  const color = services.color;
  const delivery = services.modules.filter((m) => m.family === "DELIVERY");
  const others = services.modules.filter((m) => m.family !== "DELIVERY");
  const hasButton = services.modules.length > 0;
  const tabs = hasButton ? [...TABS.slice(0, 2), null, ...TABS.slice(2)] : TABS;
  const [sheet, setSheet] = useState(false);
  const recent = (useStored<RecentOrder[]>(RECENT_KEY) ?? []).filter((r) => r.kind === "PARCEL").slice(0, 2);
  useEffect(() => setSheet(false), [pathname]);
  const zedPage = pathname.startsWith("/app/zed") || pathname.startsWith("/colis") || pathname.startsWith("/app/services");
  // Le suivi d'une commande appartient à « Commandes ».
  const active = (href: string) =>
    href === "/app" ? pathname === "/app" : pathname.startsWith(href) || (href === "/app/commandes" && /^\/(suivi|commande)(\/|$)/.test(pathname));

  return (
    <div className="mx-auto min-h-screen max-w-md overflow-x-clip app-bg pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
      <main id="contenu">{children}</main>
      {count > 0 && cart && pathname.startsWith("/app") && !pathname.startsWith("/app/connexion") && !pathname.startsWith("/app/zed") && !pathname.startsWith("/app/services") && (
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
            <div className="space-y-2 rounded-[12px] bg-surface p-4 shadow-[0_-8px_40px_rgb(0_0_0/0.18)]">
              <span className="mx-auto mb-1 block h-1 w-10 rounded-full bg-stone-200" aria-hidden="true" />
              <p className="pb-1 text-[19px] font-bold">{tr("Que voulez-vous faire ?")}</p>
              {delivery.length > 0 && <p className="text-[12px] font-semibold uppercase tracking-wide text-stone-500">{tr("Livraison et transport")}</p>}
              {delivery.map((m) =>
                m.state === "ON" && m.href ? (
                  <ZedChoice key={m.code} href={m.href} emoji={m.emoji} tone={m.code === "PARCEL" ? "bg-sun-soft" : "bg-emerald-50"} title={text(m).label} hint={text(m).hint} />
                ) : (
                  <SoonChoice key={m.code} module={m} title={text(m).label} />
                ),
              )}
              {others.length > 0 && (
                <>
                  <p className="pt-2 text-[12px] font-semibold uppercase tracking-wide text-stone-500">{tr("Courses et services")}</p>
                  <ul className="grid grid-cols-3 gap-2">
                    {others.map((m) => (
                      <li key={m.code}>
                        <ServiceTile module={m} label={text(m).short} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {moduleOn(services, "PARCEL") && recent.length > 0 && (
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
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-surface pb-[env(safe-area-inset-bottom)]">
        <ul className={`mx-auto grid max-w-md ${hasButton ? "grid-cols-5" : "grid-cols-4"}`}>
          {tabs.map((t) =>
            t === null ? (
              <li key="zed" className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setSheet((o) => !o)}
                  aria-expanded={sheet}
                  aria-current={zedPage ? "page" : undefined}
                  aria-label={sheet ? tr("Fermer") : tr("Services")}
                  className={`-mt-6 flex flex-col items-center gap-1 text-[11px] font-semibold transition active:scale-95 ${look.text}`}
                >
                  <span className={`grid h-[60px] w-[60px] place-items-center rounded-[18px] shadow-[0_8px_24px_rgb(0_0_0/0.28)] ring-4 ring-white transition ${sheet ? "bg-ink-deep text-white" : `sheen ${look.button} ${color === "SUN" ? "deep-sun" : color === "GREEN" ? "deep-green" : ""}`}`}>
                    <Icon name={sheet ? "close" : "grid"} className={sheet ? "h-7 w-7" : "h-8 w-8"} />
                  </span>
                  {sheet ? tr("Fermer") : tr("Services")}
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

// Service annoncé mais pas encore ouvert : visible, grisé, non cliquable.
function SoonChoice({ module, title }: { module: ServiceModule; title: string }) {
  const tr = useT();
  return (
    <div aria-disabled="true" className="flex items-center gap-3 rounded-[12px] bg-stone-100 p-3 opacity-70">
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[10px] bg-surface text-[28px]" aria-hidden="true">
        {module.emoji}
      </span>
      <span className="min-w-0 flex-1 text-[16px] font-semibold">{title}</span>
      <span className="rounded-[6px] bg-stone-200 px-2 py-0.5 text-[11px] font-bold uppercase text-stone-600">{tr("Bientôt")}</span>
    </div>
  );
}

// Tuile d'un service secondaire : lien quand il est ouvert, grisée avec « Bientôt » quand il est seulement annoncé.
function ServiceTile({ module, label }: { module: ServiceModule; label: string }) {
  const tr = useT();
  const body = (
    <>
      {module.state === "SOON" && <span className="absolute right-1 top-1 rounded-[5px] bg-stone-200 px-1.5 py-0.5 text-[9px] font-bold uppercase text-stone-500">{tr("Bientôt")}</span>}
      <span className={`grid h-11 w-11 place-items-center rounded-[12px] bg-surface text-[24px] ${module.state === "SOON" ? "opacity-60" : ""}`} aria-hidden="true">
        {module.emoji}
      </span>
      <span className={`text-[12.5px] font-semibold leading-tight ${module.state === "SOON" ? "text-stone-500" : ""}`}>{label}</span>
    </>
  );
  const cls = "relative flex min-h-[96px] flex-col items-center justify-center gap-1.5 rounded-[12px] bg-stone-100 px-1 py-3 text-center";
  return module.state === "ON" && module.href ? (
    <Link href={module.href} className={`${cls} transition active:scale-[0.97]`}>
      {body}
    </Link>
  ) : (
    <div aria-disabled="true" aria-label={`${label} · ${tr("Bientôt")}`} className={cls}>
      {body}
    </div>
  );
}
