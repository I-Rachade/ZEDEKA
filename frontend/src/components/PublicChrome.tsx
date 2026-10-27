"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// En-tête du site public ; l'admin, l'espace restaurant et l'espace loueur ont leur propre cadre.
export default function PublicChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const panel = /^\/(admin|restaurant|location)(\/|$)/.test(pathname) && !pathname.endsWith("/connexion");
  if (panel) return <>{children}</>;

  return (
    <>
      <header className="bg-emerald-600 text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-xl font-bold tracking-tight">
            Zedeka
          </Link>
          <span className="text-sm opacity-90">En même temps</span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-6">{children}</main>
    </>
  );
}
