"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { distanceKm, km, usePosition, type AppRestaurant, type HistoryEntry } from "@/lib/customer";
import { initials, patternClass } from "@/lib/pattern";

// Briques communes de l'application client.

export const card = "rounded-2xl bg-white shadow-sm ring-1 ring-stone-100";
export const input = "w-full rounded-xl border border-stone-300 bg-white px-3 py-3 outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100";
export const primary = "inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-60";
export const secondary = "inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-3 font-medium text-stone-800";

export function TopBar({ title, back, action }: { title: string; back?: string | true; action?: React.ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-stone-100 bg-white/95 px-2 py-2 backdrop-blur">
      {back ? (
        <button
          onClick={() => (back === true ? router.back() : router.push(back))}
          aria-label="Retour"
          className="grid h-10 w-10 place-items-center rounded-full text-stone-700 hover:bg-stone-100"
        >
          <Icon name="back" />
        </button>
      ) : (
        <span className="w-2" />
      )}
      <h1 className="flex-1 truncate text-lg font-semibold">{title}</h1>
      {action}
    </header>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-stone-100 text-stone-500">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <p className="font-semibold">{title}</p>
      {children && <div className="text-sm text-stone-600">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${card} flex items-center gap-3 p-3`}>
          <span className="skeleton h-14 w-14 shrink-0 rounded-xl" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3.5 w-2/3 rounded-full" />
            <span className="skeleton block h-3 w-1/2 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function Logo({ url, name, size = "h-14 w-14" }: { url: string | null; name: string; size?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- logos fournis par les partenaires
    return <img src={url} alt="" className={`${size} shrink-0 rounded-xl object-cover`} />;
  }
  // Pas de logo : motif pagne et initiales, plutôt qu'une lettre sur fond uni.
  return (
    <span className={`${size} ${patternClass(name)} relative block shrink-0 overflow-hidden rounded-xl`} aria-hidden="true">
      <span className="font-display absolute bottom-1 right-1 rounded-md bg-white/90 px-1 text-[11px] font-extrabold text-ink">{initials(name)}</span>
    </span>
  );
}

export function RestaurantCard({ r }: { r: AppRestaurant }) {
  const closed = !r.availability.open;
  const position = usePosition();
  const distance = position ? distanceKm(position, r) : null;
  return (
    <Link href={`/r/${r.slug}`} className={`${card} block p-3 transition active:scale-[0.99]`}>
      <div className="flex gap-3">
        <div className={closed ? "opacity-50 grayscale" : ""}>
          <Logo url={r.logoUrl} name={r.name} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-semibold">{r.name}</p>
            {closed ? (
              <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-600">Fermé</span>
            ) : (
              r.deliveryFee === 0 && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Livraison gratuite</span>
            )}
          </div>
          <p className="truncate text-sm text-stone-500">{r.categories.slice(0, 3).join(" · ") || r.address}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-600">
            <span className="inline-flex items-center gap-1">
              <Icon name="clock" className="h-3.5 w-3.5" /> {r.deliveryTimeMin}–{r.deliveryTimeMax} min
            </span>
            {distance !== null && (
              <span className="inline-flex items-center gap-1">
                <Icon name="pin" className="h-3.5 w-3.5" /> {km(distance)}
              </span>
            )}
            {r.deliveryFee !== null && r.deliveryFee > 0 && (
              <span className="inline-flex items-center gap-1">
                <Icon name="rider" className="h-3.5 w-3.5" /> {r.feeFrom ? "dès " : ""}
                {fcfa(r.deliveryFee)}
              </span>
            )}
            {r.minOrderAmount > 0 && <span>min. {fcfa(r.minOrderAmount)}</span>}
          </p>
          {closed && r.availability.reason && <p className="mt-1 truncate text-xs text-stone-500">{r.availability.reason}</p>}
        </div>
      </div>
      {r.dishes.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-stone-100 pt-2 text-sm">
          {r.dishes.map((d) => (
            <li key={d.id} className="flex justify-between gap-2">
              <span className="truncate">{d.name}</span>
              <span className="shrink-0 text-stone-600">{fcfa(d.price)}</span>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}

// Libellés côté client (l'admin et les partenaires ont les leurs).
const ORDER_STATUS: Record<string, [string, string]> = {
  PENDING: ["Reçue", "bg-amber-100 text-amber-800"],
  CONFIRMED: ["Acceptée", "bg-sky-100 text-sky-800"],
  PREPARING: ["En préparation", "bg-orange-100 text-orange-800"],
  READY: ["Prête", "bg-lime-100 text-lime-800"],
  PICKED_UP: ["En route", "bg-violet-100 text-violet-800"],
  DELIVERED: ["Livrée", "bg-emerald-100 text-emerald-800"],
  CANCELLED: ["Annulée", "bg-stone-200 text-stone-600"],
};

export function StatusBadge({ status }: { kind?: HistoryEntry["kind"]; status: string }) {
  const [label, color] = ORDER_STATUS[status] ?? [status, "bg-stone-100 text-stone-700"];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{label}</span>;
}

export const KIND: Record<HistoryEntry["kind"], { label: string; icon: IconName }> = {
  FOOD: { label: "Repas", icon: "menu" },
  PARCEL: { label: "Colis", icon: "box" },
};

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });
