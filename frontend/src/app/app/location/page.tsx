"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { apiGet, fcfa } from "@/lib/api";
import type { AppRental } from "@/lib/customer";
import { card, Empty, Logo, Skeleton, TopBar } from "../ui";

export default function Rentals() {
  const [list, setList] = useState<AppRental[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<AppRental[]>("/api/rentals").then(
      (l) => setList(l ?? []),
      (e: Error) => setError(e.message),
    );
  }, []);

  return (
    <div>
      <TopBar title="Location de véhicules" back="/app" />
      <div className="space-y-3 px-4 py-4">
        <p className="text-sm text-stone-600">Voiture ou minibus avec chauffeur, à l&apos;heure, à la journée ou au kilomètre.</p>
        {error ? (
          <Empty icon="car" title="Liste indisponible">
            {error}
          </Empty>
        ) : !list ? (
          <Skeleton />
        ) : list.length === 0 ? (
          <Empty icon="car" title="Aucun loueur pour le moment" />
        ) : (
          list.map((p) => (
            <Link key={p.slug} href={`/louer/${p.slug}`} className={`${card} flex gap-3 p-3`}>
              <div className={p.availability.open ? "" : "opacity-50 grayscale"}>
                <Logo url={p.logoUrl} name={p.name} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate font-semibold">{p.name}</p>
                  {!p.availability.open && <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-600">Fermé</span>}
                </div>
                <p className="truncate text-sm text-stone-500">{p.vehicles.join(" · ")}</p>
                <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-stone-600">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="clock" className="h-3.5 w-3.5" /> prise en charge {p.pickupTimeMin}–{p.pickupTimeMax} min
                  </span>
                  {p.priceFrom !== null && <span>dès {fcfa(p.priceFrom)}</span>}
                </p>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
