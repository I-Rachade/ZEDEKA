"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setToken } from "@/lib/admin";

const LINKS = [
  { href: "/admin", label: "Tableau de bord" },
  { href: "/admin/commandes", label: "Commandes" },
  { href: "/admin/restaurants", label: "Restaurants" },
  { href: "/admin/livreurs", label: "Livreurs" },
  { href: "/admin/zones", label: "Zones" },
  { href: "/admin/rapport", label: "Rapport" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  if (pathname === "/admin/connexion") return null;

  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 ${active ? "bg-emerald-600 text-white" : "bg-white text-stone-700"}`}
          >
            {l.label}
          </Link>
        );
      })}
      <button
        onClick={() => {
          setToken(null);
          router.replace("/admin/connexion");
        }}
        className="ml-auto whitespace-nowrap px-3 py-1.5 text-stone-500"
      >
        Déconnexion
      </button>
    </nav>
  );
}
