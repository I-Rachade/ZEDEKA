"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { beep } from "@/components/panel/beep";
import Shell, { type NavGroup } from "@/components/panel/Shell";
import { rental, type TripStatus } from "@/lib/rental";

type Counts = Record<TripStatus | "SCHEDULED" | "ALL", number>;

export default function RentalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [name, setName] = useState("Loueur");
  const [ready, setReady] = useState(false);
  const lastPending = useRef<number | null>(null);
  const login = pathname === "/location/connexion";

  useEffect(() => {
    if (login) return;
    if (!rental.getToken()) {
      router.replace("/location/connexion");
      return;
    }
    setName(rental.getName() ?? "Loueur");
    setReady(true);
    const load = () =>
      rental
        .apiFetch<Counts>("/trips/counts")
        .then((c) => {
          if (lastPending.current !== null && c.PENDING > lastPending.current) {
            beep();
            window.dispatchEvent(new Event("zedeka:new-trip"));
          }
          lastPending.current = c.PENDING;
          setCounts(c);
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    window.addEventListener("zedeka:trips-changed", load);
    return () => {
      clearInterval(t);
      window.removeEventListener("zedeka:trips-changed", load);
    };
  }, [login, router]);

  if (login) return <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>;

  const nav: NavGroup[] = [
    { items: [{ href: "/location", label: "Tableau de bord", icon: "home", exact: true }] },
    {
      title: "Courses",
      items: [
        { href: "/location/courses", label: "Courses", icon: "orders", count: counts?.PENDING },
        { href: "/location/courses?statut=ONGOING", label: "En cours", icon: "clock", count: counts?.ONGOING },
      ],
    },
    {
      title: "Flotte",
      items: [
        { href: "/location/vehicules", label: "Véhicules", icon: "car" },
        { href: "/location/chauffeurs", label: "Chauffeurs", icon: "user" },
      ],
    },
    {
      title: "Gestion",
      items: [
        { href: "/location/reglages", label: "Réglages", icon: "settings" },
        { href: "/location/releves", label: "Relevés", icon: "wallet" },
      ],
    },
  ];

  return (
    <Shell
      area="Location"
      nav={nav}
      mobileNav={["/location", "/location/courses", "/location/vehicules", "/location/chauffeurs"]}
      userName={name}
      userRole="Loueur"
      onLogout={rental.logout}
      searchPlaceholder="Rechercher une course (code, nom, téléphone)"
      onSearch={(q) => router.push(`/location/courses?q=${encodeURIComponent(q)}`)}
    >
      {ready ? children : null}
    </Shell>
  );
}
