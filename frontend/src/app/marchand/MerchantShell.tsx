"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Icon, type IconName } from "@/components/panel/icons";
import { useSession } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { LOGIN_HREF, merchantFetch, NeedsLogin, type Me } from "@/lib/merchant";

type Ctx = { me: Me | null; reload: () => Promise<void> };
const MerchantContext = createContext<Ctx>({ me: null, reload: async () => {} });
export const useMerchant = () => useContext(MerchantContext);

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/marchand", label: "Accueil", icon: "home" },
  { href: "/marchand/colis", label: "Colis", icon: "box" },
  { href: "/marchand/argent", label: "Argent", icon: "wallet" },
  { href: "/marchand/boutique", label: "Boutique", icon: "store" },
];

// Cadre de l'appli marchand : largeur d'un téléphone (centrée sur ordinateur), onglets en bas avec le gros bouton
// « Envoyer » au milieu. Sans session : connexion ; connecté sans boutique : création de la boutique.
export default function MerchantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const hydrated = useHydrated();
  const session = useSession();
  const [me, setMe] = useState<Me | null>(null);
  const login = pathname.startsWith("/marchand/connexion");

  const reload = useCallback(async () => {
    try {
      setMe(await merchantFetch<Me>("/me"));
    } catch (e) {
      if (e instanceof NeedsLogin) router.replace(LOGIN_HREF);
    }
  }, [router]);

  useEffect(() => {
    if (!hydrated || login) return;
    if (!session) {
      router.replace(LOGIN_HREF);
      return;
    }
    reload();
  }, [hydrated, session, login, reload, router]);

  // Pas encore de boutique : on la crée d'abord.
  useEffect(() => {
    if (me && !me.merchant && pathname !== "/marchand/boutique") router.replace("/marchand/boutique");
  }, [me, pathname, router]);

  if (login) return <div className="flat-ui mx-auto min-h-screen max-w-md bg-stone-50">{children}</div>;
  if (!hydrated || !session || !me) {
    return (
      <div className="grid min-h-screen place-items-center bg-stone-50" aria-busy="true">
        <span className="keep-round h-8 w-8 animate-spin rounded-full border-[3px] border-emerald-600/20 border-t-emerald-600" />
      </div>
    );
  }
  const active = (href: string) => (href === "/marchand" ? pathname === "/marchand" : pathname.startsWith(href));
  const ready = !!me.merchant;

  return (
    <MerchantContext.Provider value={{ me, reload }}>
      <div className="flat-ui mx-auto min-h-screen max-w-md overflow-x-clip bg-white pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        <main id="contenu">{children}</main>
        {ready && (
          <nav className="glass hairline-t fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)]">
            <ul className="mx-auto grid max-w-md grid-cols-5">
              {[...TABS.slice(0, 2), null, ...TABS.slice(2)].map((tab) =>
                tab === null ? (
                  <li key="send" className="flex justify-center">
                    <Link
                      href="/marchand/envoyer"
                      aria-current={pathname.startsWith("/marchand/envoyer") ? "page" : undefined}
                      className="-mt-6 flex flex-col items-center gap-0.5 text-[11px] font-semibold text-emerald-700 transition active:scale-95"
                    >
                      <span className="grid h-[56px] w-[56px] place-items-center bg-emerald-600 text-white ring-4 ring-white">
                        <Icon name="plus" className="h-8 w-8" />
                      </span>
                      {t("Envoyer")}
                    </Link>
                  </li>
                ) : (
                  <li key={tab.href}>
                    <Link
                      href={tab.href}
                      aria-current={active(tab.href) ? "page" : undefined}
                      className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium transition-colors ${active(tab.href) ? "text-emerald-600" : "text-stone-500"}`}
                    >
                      <Icon name={tab.icon} className="h-[26px] w-[26px]" />
                      {t(tab.label)}
                    </Link>
                  </li>
                ),
              )}
            </ul>
          </nav>
        )}
      </div>
    </MerchantContext.Provider>
  );
}
