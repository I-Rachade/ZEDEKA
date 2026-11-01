"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Shell, { type NavBadge, type NavGroup } from "@/components/panel/Shell";
import { adminFetch, getToken, ROLE_LABEL, roleOf, saveStaff, seesEverything, setToken, useStaff, type Staff } from "@/lib/admin";
import NotificationCenter from "./NotificationCenter";

type Counts = {
  newOrders: number;
  ordersInProgress?: number;
  toDispatch: number;
  driverIssues?: number;
  parcelsInProgress?: number;
  parcelsAwaitingPosition?: number;
  pendingDrivers: number;
  driversFree?: number;
  driversBusy?: number;
  restaurantsOpen?: number;
  restaurantsClosed?: number;
  cashOrders: number;
  pendingVendors: number;
  openRequests: number;
  urgentRequests?: number;
};

// Chiffres de chaque entrée du menu, lisibles d'un coup d'œil (détail au survol).
function badgesOf(c: Counts | null) {
  const b = (value: number | undefined, tone: NavBadge["tone"], title: string, showZero = false): NavBadge => ({ value: c ? value : undefined, tone, title, showZero });
  return {
    dispatch: [b(c?.toDispatch, "amber", "{n} course(s) à attribuer"), b(c?.driverIssues, "red", "{n} problème(s) signalé(s) par les livreurs")],
    orders: [b(c?.newOrders, "amber", "{n} nouvelle(s) commande(s) à confirmer"), b(c?.ordersInProgress, "grey", "{n} commande(s) en cours")],
    parcels: [b(c?.parcelsAwaitingPosition, "amber", "{n} colis en attente de la position du destinataire"), b(c?.parcelsInProgress, "grey", "{n} colis en cours")],
    requests: [b(c?.urgentRequests, "red", "{n} demande(s) urgente(s) non closes"), b(c?.openRequests, "amber", "{n} demande(s) à traiter")],
    vendors: [b(c?.pendingVendors, "amber", "{n} candidature(s) à examiner")],
    restaurants: [b(c?.restaurantsOpen, "green", "{n} ouvert(s) en ce moment", true), b(c?.restaurantsClosed, "red", "{n} fermé(s) en ce moment", true)],
    drivers: [
      b(c?.driversFree, "green", "{n} livreur(s) en ligne et libre(s)", true),
      b(c?.driversBusy, "grey", "{n} livreur(s) en course", true),
      b(c?.pendingDrivers, "amber", "{n} candidature(s) de livreur à examiner"),
    ],
    finances: [b(c?.cashOrders, "amber", "{n} encaissement(s) d'espèces à récupérer")],
  };
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const login = pathname === "/admin/connexion";
  const staff = useStaff();
  const role = roleOf(staff);
  // Directeur et administrateur adjoint ont le même menu ; l'adjoint a certaines pages en lecture seule.
  const director = seesEverything(role);
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

  const badges = badgesOf(counts);

  if (login) return <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>;

  const nav: NavGroup[] = [
    { items: [{ href: "/admin", label: "Tableau de bord", icon: "home", exact: true }] },
    {
      title: "Commandes",
      items: [
        { href: "/admin/dispatch", label: "Répartition", icon: "dispatch", count: counts?.toDispatch, badges: badges.dispatch },
        { href: "/admin/commandes", label: "Commandes", icon: "orders", count: counts?.newOrders, badges: badges.orders },
        { href: "/admin/colis", label: "Colis", icon: "box", badges: badges.parcels },
        ...(role !== "DISPATCHER" ? [{ href: "/admin/demandes", label: "Demandes", icon: "phone" as const, count: counts?.openRequests, badges: badges.requests }] : []),
      ],
    },
    director
      ? {
          title: "Partenaires",
          items: [
            { href: "/admin/candidatures", label: "Candidatures", icon: "bell", count: counts?.pendingVendors, badges: badges.vendors },
            { href: "/admin/restaurants", label: "Restaurants", icon: "store", badges: badges.restaurants },
            { href: "/admin/livreurs", label: "Livreurs", icon: "rider", count: counts?.pendingDrivers, badges: badges.drivers },
            { href: "/admin/zones", label: "Zones", icon: "map" },
          ],
        }
      : manager
        ? {
            title: "Partenaires",
            items: [
              { href: "/admin/partenaires", label: "Restaurants et boutiques", icon: "store", badges: badges.restaurants },
              { href: "/admin/livreurs", label: "Livreurs", icon: "rider", count: counts?.pendingDrivers, badges: badges.drivers },
            ],
          }
        : { title: "Équipe terrain", items: [{ href: "/admin/livreurs", label: "Livreurs", icon: "rider", count: counts?.pendingDrivers, badges: badges.drivers }] },
    ...(director
      ? [
          {
            title: "Gestion",
            items: [
              { href: "/admin/finances", label: "Finances", icon: "wallet", count: counts?.cashOrders, badges: badges.finances },
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
      headerActions={<NotificationCenter role={staff?.role} />}
    >
      {children}
    </Shell>
  );
}
