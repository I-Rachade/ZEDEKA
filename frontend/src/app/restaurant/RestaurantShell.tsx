"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Shell, { type NavGroup } from "@/components/panel/Shell";
import { OpenSwitch, OrderAlarm, PushBanner, useWakeLock, type OpenState } from "@/components/panel/partner";
import { restaurantClient } from "@/lib/partnerClients";
import { getRestaurantName, getRestaurantToken, logout, restaurantFetch } from "@/lib/restaurant";
import { tr } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

type Counts = Record<"PENDING" | "CONFIRMED" | "PREPARING" | "READY", number>;

export default function RestaurantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [name, setName] = useState("Restaurant");
  const [ready, setReady] = useState(false);
  const lastPending = useRef<number | null>(null);
  const login = pathname === "/restaurant/connexion" || pathname === "/restaurant/mot-de-passe";
  const [status, setStatus] = useState<OpenState | null>(null);
  const t = useT();
  const loadStatus = () => restaurantFetch<OpenState>("/me").then(setStatus, () => {});
  useWakeLock(ready);

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
            window.dispatchEvent(new Event("zedeka:new-order"));
          }
          lastPending.current = c.PENDING;
          setCounts(c);
          document.title = `${c.PENDING ? `(${c.PENDING}) ` : ""}${tr("Espace restaurant")} – Zedeka`;
        })
        .catch(() => {});
    load();
    loadStatus();
    const timer = setInterval(load, 20_000);
    window.addEventListener("zedeka:orders-changed", load);
    window.addEventListener("zedeka:settings-changed", loadStatus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("zedeka:orders-changed", load);
      window.removeEventListener("zedeka:settings-changed", loadStatus);
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
        { href: "/restaurant/tables", label: "Tables et QR codes", icon: "qr" },
        { href: "/restaurant/reglages", label: "Horaires et réglages", icon: "settings" },
        { href: "/restaurant/releves", label: "Relevés", icon: "wallet" },
      ],
    },
    { title: "Compte", items: [{ href: "/restaurant/compte", label: "Mon compte", icon: "user" }] },
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
      accountHref="/restaurant/compte"
      headerActions={<OpenSwitch api={restaurantClient} state={status} onChange={loadStatus} />}
      overlay={
        ready && counts ? (
          <OrderAlarm area="restaurant" pending={counts.PENDING} label={(n) => (n > 1 ? t("{n} nouvelles commandes", { n }) : t("Nouvelle commande"))} onView={() => router.push("/restaurant/commandes?statut=PENDING")} />
        ) : null
      }
    >
      {ready && <PushBanner api={restaurantClient} what="nouvelle commande" />}
      {ready ? children : null}
    </Shell>
  );
}
