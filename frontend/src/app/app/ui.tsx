"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { distanceKm, km, usePosition, type AppRestaurant, type HistoryEntry } from "@/lib/customer";
import { initials, patternClass } from "@/lib/pattern";

// Briques communes de l'application client.

// Style iOS : cartes blanches sans bordure sur fond gris clair, champs gris remplis, gros boutons arrondis.
export const card = "rounded-[20px] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)]";
export const input = "w-full rounded-xl border border-transparent bg-stone-100 px-3.5 py-3 outline-none transition placeholder:text-stone-400 focus:border-emerald-600/40 focus:bg-white focus:ring-4 focus:ring-emerald-600/10";
export const primary = "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-[17px] font-semibold text-white transition active:scale-[0.98] active:opacity-90 disabled:opacity-40";
export const secondary = "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600/10 px-4 py-3.5 text-[17px] font-semibold text-emerald-700 transition active:scale-[0.98]";

export function TopBar({ title, back, onBack, action }: { title: string; back?: string | true; onBack?: () => void; action?: React.ReactNode }) {
  const router = useRouter();
  return (
    // Barre de navigation iOS : translucide, titre centré, « Retour » à gauche dans la couleur de la marque.
    <header className="glass hairline-b sticky top-0 z-30 grid h-[calc(3rem+env(safe-area-inset-top))] grid-cols-[1fr_auto_1fr] items-center px-2 pt-[env(safe-area-inset-top)]">
      <span className="flex">
        {(back || onBack) && (
          <button
            onClick={() => (onBack ? onBack() : back === true ? router.back() : router.push(back as string))}
            className="flex h-10 items-center pr-2 text-[17px] text-emerald-600 active:opacity-50"
          >
            <Icon name="back" className="h-6 w-6" />
            Retour
          </button>
        )}
      </span>
      <h1 className="max-w-[55vw] truncate text-center text-[17px] font-semibold">{title}</h1>
      <span className="flex justify-end">{action}</span>
    </header>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-stone-200/70 text-stone-500">
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
    return <img src={url} alt="" className={`${size} shrink-0 rounded-[14px] object-cover`} />;
  }
  // Pas de logo : motif pagne et initiales, plutôt qu'une lettre sur fond uni.
  return (
    <span className={`${size} ${patternClass(name)} relative block shrink-0 overflow-hidden rounded-[14px]`} aria-hidden="true">
      <span className="font-display absolute bottom-1 right-1 rounded-md bg-white/90 px-1 text-[11px] font-extrabold text-ink">{initials(name)}</span>
    </span>
  );
}

export function RestaurantCard({ r }: { r: AppRestaurant }) {
  const closed = !r.availability.open;
  const position = usePosition();
  const distance = position ? distanceKm(position, r) : null;
  return (
    <Link href={`/r/${r.slug}`} className={`${card} block p-4 transition active:scale-[0.98]`}>
      <div className="flex gap-3">
        <div className={closed ? "opacity-50 grayscale" : ""}>
          <Logo url={r.logoUrl} name={r.name} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[17px] font-semibold">{r.name}</p>
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
        <ul className="hairline-t mt-3 space-y-1 pt-2.5 text-[15px]">
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
