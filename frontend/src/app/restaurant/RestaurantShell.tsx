"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Shell, { type NavGroup } from "@/components/panel/Shell";
import { beep } from "@/components/panel/beep";
import { getRestaurantName, getRestaurantToken, logout, restaurantFetch } from "@/lib/restaurant";

type Counts = Record<"PENDING" | "CONFIRMED" | "PREPARING" | "READY", number>;

export default function RestaurantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [name, setName] = useState("Restaurant");
  const [ready, setReady] = useState(false);
  const lastPending = useRef<number | null>(null);
  const login = pathname === "/restaurant/connexion";

  useEffect(() => {
    if (login) return;
    if (!getRestaurantToken()) {
      router.replace("/restaurant/connexion");
      return;
    }
    setName(getRestaurantName() ?? "Restaurant");
    setReady(true);
    const load = () =>
      restaurantFetch<Counts>("/orders/counts")
        .then((c) => {
          if (lastPending.current !== null && c.PENDING > lastPending.current) {
            beep();
            window.dispatchEvent(new Event("zedeka:new-order"));
          }
          lastPending.current = c.PENDING;
          setCounts(c);
          document.title = c.PENDING ? `(${c.PENDING}) Espace restaurant – Zedeka` : "Espace restaurant – Zedeka";
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    window.addEventListener("zedeka:orders-changed", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("zedeka:orders-changed", load);
    };
  }, [login, router]);

  if (login) return <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>;

  const active = counts ? counts.CONFIRMED + counts.PREPARING : undefined;
  const nav: NavGroup[] = [
    { items: [{ href: "/restaurant", label: "Tableau de bord", icon: "home", exact: true }] },
    {
      title: "Commandes",
      items: [
        { href: "/restaurant/commandes", label: "Commandes", icon: "orders", count: counts?.PENDING },
        { href: "/restaurant/commandes?statut=PREPARING", label: "En cuisine", icon: "fire", count: active },
      ],
    },
    {
      title: "Restaurant",
      items: [
        { href: "/restaurant/carte", label: "Carte", icon: "menu" },
        { href: "/restaurant/reglages", label: "Horaires et réglages", icon: "settings" },
        { href: "/restaurant/releves", label: "Relevés", icon: "wallet" },
      ],
    },
  ];

  return (
    <Shell
      area="Restaurant"
      nav={nav}
      mobileNav={["/restaurant", "/restaurant/commandes", "/restaurant/carte", "/restaurant/reglages"]}
      userName={name}
      userRole="Gérant"
      onLogout={logout}
      searchPlaceholder="Rechercher une commande (code, nom, téléphone)"
      onSearch={(q) => router.push(`/restaurant/commandes?q=${encodeURIComponent(q)}`)}
    >
      {ready ? children : null}
    </Shell>
  );
}
