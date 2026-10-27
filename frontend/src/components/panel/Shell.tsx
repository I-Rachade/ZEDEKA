"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; icon: IconName; count?: number; exact?: boolean };
export type NavGroup = { title?: string; items: NavItem[] };

type Props = {
  area: string; // ex. « Admin », « Restaurant »
  nav: NavGroup[];
  mobileNav: string[]; // hrefs affichés dans la barre du bas (4 au plus)
  userName: string;
  userRole: string;
  onLogout: () => void;
  searchPlaceholder?: string;
  onSearch?: (q: string) => void;
  children: React.ReactNode;
};

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function Count({ value, active }: { value?: number; active?: boolean }) {
  if (!value) return null;
  return (
    <span className={`ml-auto rounded-full px-1.5 text-xs font-semibold ${active ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"}`}>
      {value}
    </span>
  );
}

function NavList({ nav, pathname, onNavigate }: { nav: NavGroup[]; pathname: string; onNavigate?: () => void }) {
  return (
    <div className="space-y-5">
      {nav.map((group, i) => (
        <div key={i}>
          {group.title && <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-400">{group.title}</p>}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${active ? "bg-emerald-600 text-white" : "text-stone-700 hover:bg-stone-100"}`}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    <Count value={item.count} active={active} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Cadre commun de l'admin et de l'espace restaurant : menu latéral, en-tête, barre mobile.
export default function Shell({ area, nav, mobileNav, userName, userRole, onLogout, searchPlaceholder, onSearch, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [profile, setProfile] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    setDrawer(false);
    setProfile(false);
  }, [pathname]);

  const items = nav.flatMap((g) => g.items);
  const current = items.filter((i) => isActive(pathname, i)).sort((a, b) => b.href.length - a.href.length)[0];
  const home = items[0];
  const bottom = mobileNav.map((href) => items.find((i) => i.href === href)).filter((i): i is NavItem => Boolean(i));

  return (
    <div className="min-h-screen bg-stone-100 lg:pl-64">
      {/* Menu latéral (grand écran) */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-stone-200 bg-white lg:flex">
        <Link href={home?.href ?? "/"} className="flex items-center gap-2 px-5 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 font-bold text-white">Z</span>
          <span className="font-bold">Zedeka</span>
          <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{area}</span>
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <NavList nav={nav} pathname={pathname} />
        </nav>
      </aside>

      {/* Tiroir (mobile) */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Fermer le menu" onClick={() => setDrawer(false)} className="absolute inset-0 bg-black/30" />
          <nav className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-white p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="font-bold">Zedeka · {area}</span>
              <button onClick={() => setDrawer(false)} aria-label="Fermer">
                <Icon name="close" />
              </button>
            </div>
            <NavList nav={nav} pathname={pathname} onNavigate={() => setDrawer(false)} />
          </nav>
        </div>
      )}

      {/* En-tête */}
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Ouvrir le menu">
            <Icon name="more" />
          </button>
          <nav aria-label="Fil d'Ariane" className="hidden items-center gap-1 text-sm text-stone-500 sm:flex">
            <Link href={home?.href ?? "/"}>{area}</Link>
            {current && current !== home && (
              <>
                <Icon name="chevron" className="h-4 w-4" />
                <Link href={current.href} className="text-stone-800">
                  {current.label}
                </Link>
              </>
            )}
          </nav>
          <span className="font-semibold sm:hidden">{current?.label ?? area}</span>
          {onSearch && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) onSearch(q.trim());
              }}
              className="ml-auto hidden items-center gap-2 rounded-lg bg-stone-100 px-3 py-1.5 md:flex"
            >
              <Icon name="search" className="h-4 w-4 text-stone-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-64 bg-transparent text-sm outline-none"
              />
            </form>
          )}
          <div className={`relative ${onSearch ? "md:ml-0" : ""} ml-auto`}>
            <button onClick={() => setProfile((p) => !p)} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-stone-100">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-sm font-semibold text-emerald-800">
                {userName.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden text-left text-sm leading-tight sm:block">
                <span className="block font-medium">{userName}</span>
                <span className="block text-xs text-stone-500">{userRole}</span>
              </span>
            </button>
            {profile && (
              <div className="absolute right-0 mt-1 w-48 rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
                <span className="block px-3 py-2 text-xs text-stone-500">Langue : français</span>
                <button
                  onClick={() => {
                    onLogout();
                    router.replace(`/${pathname.split("/")[1]}/connexion`);
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-stone-100"
                >
                  <Icon name="logout" className="h-4 w-4" />
                  Déconnexion
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5 pb-24 lg:pb-8">{children}</main>

      {/* Barre du bas (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-stone-200 bg-white lg:hidden print:hidden">
        {bottom.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link key={item.href} href={item.href} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "text-emerald-700" : "text-stone-500"}`}>
              <Icon name={item.icon} />
              {item.label.split(" ")[0]}
              {item.count ? (
                <span className="absolute right-[22%] top-1 rounded-full bg-emerald-600 px-1 text-[10px] font-semibold text-white">{item.count}</span>
              ) : null}
            </Link>
          );
        })}
        <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-stone-500">
          <Icon name="more" />
          Menu
        </button>
      </nav>
    </div>
  );
}
