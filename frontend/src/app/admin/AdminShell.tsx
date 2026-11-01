"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Shell, { type NavGroup } from "@/components/panel/Shell";
import { adminFetch, getToken, ROLE_LABEL, roleOf, saveStaff, setToken, useStaff, type Staff } from "@/lib/admin";

type Counts = { newOrders: number; toDispatch: number; pendingDrivers: number; cashOrders: number; pendingVendors: number; openRequests: number };

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const login = pathname === "/admin/connexion";
  const staff = useStaff();
  const role = roleOf(staff);
  const director = role === "DIRECTOR";
  const manager = role === "MANAGER";

  // Rôle à jour à chaque ouverture (un compte peut changer de rôle ou être désactivé).
  useEffect(() => {
    if (login || !getToken()) return;
    adminFetch<Staff>("/me").then(saveStaff, () => {});
  }, [login]);

  // Le dispatcheur ou la managerin qui ouvre un écran du directeur revient au tableau de bord ;
  // le dispatcheur n'a pas non plus les demandes ni la liste des partenaires.
  const directorOnly = /^\/admin\/(candidatures|restaurants|zones|finances|rapport|reglages|equipe)(\/|$)/.test(pathname);
  const managerOnly = /^\/admin\/(demandes|partenaires)(\/|$)/.test(pathname);
  useEffect(() => {
    if ((!director && directorOnly) || (role === "DISPATCHER" && managerOnly)) router.replace("/admin");
  }, [director, directorOnly, managerOnly, role, router]);

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
        ...(role !== "DISPATCHER" ? [{ href: "/admin/demandes", label: "Demandes", icon: "phone" as const, count: counts?.openRequests }] : []),
      ],
    },
    director
      ? {
          title: "Partenaires",
          items: [
            { href: "/admin/candidatures", label: "Candidatures", icon: "bell", count: counts?.pendingVendors },
            { href: "/admin/restaurants", label: "Restaurants", icon: "store" },
            { href: "/admin/livreurs", label: "Livreurs", icon: "rider", count: counts?.pendingDrivers },
            { href: "/admin/zones", label: "Zones", icon: "map" },
          ],
        }
      : manager
        ? {
            title: "Partenaires",
            items: [
              { href: "/admin/partenaires", label: "Restaurants et boutiques", icon: "store" },
              { href: "/admin/livreurs", label: "Livreurs", icon: "rider", count: counts?.pendingDrivers },
            ],
          }
        : { title: "Équipe terrain", items: [{ href: "/admin/livreurs", label: "Livreurs", icon: "rider", count: counts?.pendingDrivers }] },
    ...(director
      ? [
          {
            title: "Gestion",
            items: [
              { href: "/admin/finances", label: "Finances", icon: "wallet", count: counts?.cashOrders },
              { href: "/admin/rapport", label: "Rapport", icon: "chart" },
              { href: "/admin/equipe", label: "Équipe", icon: "user" },
              { href: "/admin/reglages", label: "Réglages", icon: "settings" },
            ],
          } satisfies NavGroup,
        ]
      : []),
  ];

  return (
    <Shell
      area="Admin"
      nav={nav}
      mobileNav={["/admin", "/admin/dispatch", "/admin/commandes", director ? "/admin/restaurants" : manager ? "/admin/demandes" : "/admin/livreurs"]}
      userName={staff?.id ? staff.name : "Direction"}
      userRole={staff?.id ? ROLE_LABEL[staff.role] : "Directeur des opérations"}
      onLogout={() => setToken(null)}
      searchPlaceholder="Rechercher une commande (code, nom, téléphone)"
      onSearch={(q) => router.push(`/admin/commandes?q=${encodeURIComponent(q)}`)}
    >
      {children}
    </Shell>
  );
}
