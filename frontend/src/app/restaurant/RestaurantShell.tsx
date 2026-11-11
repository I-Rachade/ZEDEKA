"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Shell, { type NavGroup } from "@/components/panel/Shell";
import { OpenSwitch, OrderAlarm, PushBanner, useWakeLock, type OpenState } from "@/components/panel/partner";
import { restaurantClient } from "@/lib/partnerClients";
import { getRestaurantName, getRestaurantRole, getRestaurantToken, logout, restaurantFetch, ROLE_LABEL, type Me, type RestaurantRole } from "@/lib/restaurant";
import { RestaurantRoleContext } from "./RestaurantRole";
import TableCallsAlarm from "./TableCallsAlarm";
import { useAlarmAccept } from "./AlarmAccept";
import { tr } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { isPosMode } from "./caisse/mode";
import { onPulseRefresh, publishPulse, type Pulse, type PulseCounts } from "./pulse";

type Counts = PulseCounts;

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
  const [role, setRole] = useState<RestaurantRole>("OWNER");
  const [memberName, setMemberName] = useState<string | null>(null);
  const t = useT();
  const loadStatus = () =>
    restaurantFetch<Me>("/me").then((me) => {
      setStatus(me);
      setRole(me.account.role);
      setMemberName(me.account.role === "OWNER" ? null : me.account.name);
    }, () => {});
  useWakeLock(ready);
  const quickAccept = useAlarmAccept(ready && !login ? counts?.PENDING : undefined);

  useEffect(() => {
    if (login) return;
    if (!getRestaurantToken()) {
      router.replace("/restaurant/connexion");
      return;
    }
    // Le mode caisse choisi sur cet appareil s'ouvre directement à la place du tableau de bord.
    if (pathname === "/restaurant" && isPosMode()) router.replace("/restaurant/caisse");
    setName(getRestaurantName() ?? "Restaurant");
    setRole(getRestaurantRole());
    setReady(true);
    // Un seul appel régulier (le pouls) : compteurs, appels des tables et version des commandes en cours.
    const load = () =>
      restaurantFetch<Pulse>("/pulse")
        .then((p) => {
          publishPulse(p);
          const c = p.counts;
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
    // 5 s : l'alarme des tables et des nouvelles commandes sonne vite, même avec l'onglet en arrière-plan.
    const timer = setInterval(load, 5_000);
    const stopRefresh = onPulseRefresh(load);
    window.addEventListener("zedeka:orders-changed", load);
    window.addEventListener("zedeka:settings-changed", loadStatus);
    return () => {
      clearInterval(timer);
      stopRefresh();
      window.removeEventListener("zedeka:orders-changed", load);
      window.removeEventListener("zedeka:settings-changed", loadStatus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la redirection ne compte qu'à l'ouverture
  }, [login, router]);

  // La caissière n'ouvre que les commandes, le mode caisse et son compte : les autres pages la renvoient aux commandes.
  const cashierBlocked = role === "CASHIER" && !login && !/^\/restaurant\/(commandes|caisse|compte)(\/|$)/.test(pathname);
  useEffect(() => {
    if (cashierBlocked) router.replace("/restaurant/commandes");
  }, [cashierBlocked, router]);

  if (login) return <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>;
  if (pos)
    return (
      <>
        {ready && (
          <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-xl">
            <PushBanner api={restaurantClient} what="nouvelle commande" />
          </div>
        )}
        {ready && <TableCallsAlarm />}
        <RestaurantRoleContext.Provider value={role}>{ready && !cashierBlocked ? children : null}</RestaurantRoleContext.Provider>
      </>
    );

  const active = counts ? counts.CONFIRMED + counts.PREPARING : undefined;
  const cashier = role === "CASHIER";
  const orders: NavGroup = {
    title: "Commandes",
    items: [
      { href: "/restaurant/caisse", label: "Mode caisse", icon: "receipt" },
      { href: "/restaurant/commandes", label: "Commandes", icon: "orders", count: counts?.PENDING },
      { href: "/restaurant/commandes?statut=PREPARING", label: "En cuisine", icon: "fire", count: active },
      // La caissière suit aussi les commandes prêtes, que le livreur ou le client vient chercher.
      ...(cashier ? [{ href: "/restaurant/commandes?statut=READY", label: "Prêtes", icon: "bag" as const, count: counts?.READY }] : []),
    ],
  };
  const account: NavGroup = { title: "Compte", items: [{ href: "/restaurant/compte", label: "Mon compte", icon: "user" }] };
  // Caissière : commandes seulement. Gérant et manageuse : tout l'espace, avec l'équipe.
  const nav: NavGroup[] = cashier
    ? [orders, account]
    : [
        { items: [{ href: "/restaurant", label: "Tableau de bord", icon: "home", exact: true }] },
        orders,
        {
          title: "Restaurant",
          items: [
            { href: "/restaurant/carte", label: "Carte", icon: "menu" },
            { href: "/restaurant/tables", label: "Tables et QR codes", icon: "qr" },
            { href: "/restaurant/reglages", label: "Horaires et réglages", icon: "settings" },
            { href: "/restaurant/releves", label: "Relevés", icon: "wallet" },
            { href: "/restaurant/equipe", label: "Équipe", icon: "team" },
          ],
        },
        account,
      ];

  return (
    <RestaurantRoleContext.Provider value={role}>
    <Shell
      area="Restaurant"
      nav={nav}
      mobileNav={cashier ? ["/restaurant/commandes", "/restaurant/commandes?statut=PREPARING", "/restaurant/commandes?statut=READY", "/restaurant/compte"] : ["/restaurant", "/restaurant/commandes", "/restaurant/carte", "/restaurant/reglages"]}
      userName={memberName ? `${memberName} · ${name}` : name}
      userRole={ROLE_LABEL[role]}
      onLogout={logout}
      searchPlaceholder="Rechercher une commande (code, nom, téléphone)"
      onSearch={(q) => router.push(`/restaurant/commandes?q=${encodeURIComponent(q)}`)}
      accountHref="/restaurant/compte"
      headerActions={cashier ? undefined : <OpenSwitch api={restaurantClient} state={status} onChange={loadStatus} />}
      overlay={
        ready && counts ? (
          <OrderAlarm area="restaurant" pending={counts.PENDING} label={(n) => (n > 1 ? t("{n} nouvelles commandes", { n }) : t("Nouvelle commande"))} onView={() => router.push("/restaurant/commandes")} quick={quickAccept} />
        ) : null
      }
    >
      {ready && <PushBanner api={restaurantClient} what="nouvelle commande" />}
      {ready && <TableCallsAlarm />}
      {ready && !cashierBlocked ? children : null}
    </Shell>
    </RestaurantRoleContext.Provider>
  );
}
