"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Shell, { type NavGroup } from "@/components/panel/Shell";
import { adminFetch, getToken, setToken } from "@/lib/admin";

type Counts = { newOrders: number; toDispatch: number; pendingDrivers: number; cashOrders: number };

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const login = pathname === "/admin/connexion";

  useEffect(() => {
    if (login || !getToken()) return;
    const load = () => adminFetch<Counts>("/nav").then(setCounts).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [login, pathname]);

  if (login) return <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>;

  const nav: NavGroup[] = [
    { items: [{ href: "/admin", label: "Tableau de bord", icon: "home", exact: true }] },
    {
      title: "Commandes",
      items: [
        { href: "/admin/dispatch", label: "Répartition", icon: "dispatch", count: counts?.toDispatch },
        { href: "/admin/commandes", label: "Commandes", icon: "orders", count: counts?.newOrders },
        { href: "/admin/colis", label: "Colis", icon: "box" },
      ],
    },
    {
      title: "Partenaires",
      items: [
        { href: "/admin/restaurants", label: "Restaurants", icon: "store" },
        { href: "/admin/location", label: "Location", icon: "car" },
        { href: "/admin/livreurs", label: "Livreurs", icon: "rider", count: counts?.pendingDrivers },
        { href: "/admin/zones", label: "Zones", icon: "map" },
      ],
    },
    {
      title: "Gestion",
      items: [
        { href: "/admin/finances", label: "Finances", icon: "wallet", count: counts?.cashOrders },
        { href: "/admin/rapport", label: "Rapport", icon: "chart" },
        { href: "/admin/reglages", label: "Réglages", icon: "settings" },
      ],
    },
  ];

  return (
    <Shell
      area="Admin"
      nav={nav}
      mobileNav={["/admin", "/admin/dispatch", "/admin/commandes", "/admin/restaurants"]}
      userName="Direction"
      userRole="Directeur des opérations"
      onLogout={() => setToken(null)}
      searchPlaceholder="Rechercher une commande (code, nom, téléphone)"
      onSearch={(q) => router.push(`/admin/commandes?q=${encodeURIComponent(q)}`)}
    >
      {children}
    </Shell>
  );
}
