"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Shell, { type NavGroup } from "@/components/panel/Shell";
import { OpenSwitch, OrderAlarm, PushBanner, useWakeLock, type OpenState } from "@/components/panel/partner";
import { restaurantClient } from "@/lib/partnerClients";
import { getRestaurantName, getRestaurantToken, logout, restaurantFetch } from "@/lib/restaurant";
import { tr } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { isPosMode } from "./caisse/mode";

type Counts = Record<"PENDING" | "CONFIRMED" | "PREPARING" | "READY", number>;

export default function RestaurantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [name, setName] = useState("Restaurant");
  const [ready, setReady] = useState(false);
  const lastPending = useRef<number | null>(null);
  const login = pathname === "/restaurant/connexion" || pathname === "/restaurant/mot-de-passe";
  // Mode caisse : plein écran, sans menu ; il a sa propre alerte de nouvelle commande.
  const pos = pathname === "/restaurant/caisse";
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
    // Le mode caisse choisi sur cet appareil s'ouvre directement à la place du tableau de bord.
    if (pathname === "/restaurant" && isPosMode()) router.replace("/restaurant/caisse");
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
    const timer = setInterval(load, 10_000);
    window.addEventListener("zedeka:orders-changed", load);
    window.addEventListener("zedeka:settings-changed", loadStatus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("zedeka:orders-changed", load);
      window.removeEventListener("zedeka:settings-changed", loadStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la redirection ne compte qu'à l'ouverture
  }, [login, router]);

  if (login) return <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>;
  if (pos)
    return (
      <>
        {ready && (
          <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl">
            <PushBanner api={restaurantClient} what="nouvelle commande" />
          </div>
        )}
        {ready ? children : null}
      </>
    );

  const active = counts ? counts.CONFIRMED + counts.PREPARING : undefined;
  const nav: NavGroup[] = [
    {
      items: [
        { href: "/restaurant", label: "Tableau de bord", icon: "home", exact: true },
        { href: "/restaurant/caisse", label: "Mode caisse", icon: "receipt" },
      ],
    },
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
