"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { distanceKm, km, usePosition, type AppRestaurant, type HistoryEntry } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { initials, patternClass } from "@/lib/pattern";

// Briques communes de l'application client. Titres passés en français, traduits ici.

// Style iOS : cartes blanches sans bordure sur fond gris clair, champs gris remplis, gros boutons arrondis.
export const card = "card-gloss rounded-[24px] bg-white";
export const input = "w-full rounded-xl border border-transparent bg-stone-100 px-3.5 py-3 outline-none transition placeholder:text-stone-500 focus:border-emerald-600/40 focus:bg-white focus:ring-4 focus:ring-emerald-600/10";
export const primary = "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3.5 text-[17px] font-semibold text-white transition active:scale-[0.98] active:opacity-90 disabled:opacity-40";
export const secondary = "inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600/10 px-4 py-3.5 text-[17px] font-semibold text-emerald-700 transition active:scale-[0.98]";

export function TopBar({ title, back, onBack, action }: { title: string; back?: string | true; onBack?: () => void; action?: React.ReactNode }) {
  const router = useRouter();
  const t = useT();
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
            {t("Retour")}
          </button>
        )}
      </span>
      <h1 className="max-w-[55vw] truncate text-center text-[17px] font-semibold">{t(title)}</h1>
      <span className="flex justify-end">{action}</span>
    </header>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-full bg-stone-200/70 text-stone-500">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <p className="font-semibold">{t(title)}</p>
      {children && <div className="text-sm text-stone-600">{children}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  const t = useT();
  return (
    <div className="space-y-3" aria-busy="true" aria-label={t("Chargement")}>
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
    // Décoratif (alt vide) : le nom du restaurant est toujours écrit à côté, le lecteur d'écran ne le lit pas deux fois.
    // eslint-disable-next-line @next/next/no-img-element -- logos fournis par les partenaires
    return <img src={url} alt="" loading="lazy" decoding="async" className={`${size} shrink-0 rounded-[14px] object-cover`} />;
  }
  // Pas de logo : motif pagne et initiales, plutôt qu'une lettre sur fond uni.
  return (
    <span className={`${size} ${patternClass(name)} relative block shrink-0 overflow-hidden rounded-[14px]`} aria-hidden="true">
      <span className="font-display absolute bottom-1 right-1 rounded-md bg-white/90 px-1 text-[11px] font-extrabold text-ink">{initials(name)}</span>
    </span>
  );
}

// Photo d'un restaurant : premier plat photographié, sinon son logo, sinon le motif pagne et ses initiales.
export function Cover({ r, className = "" }: { r: AppRestaurant; className?: string }) {
  const url = r.coverUrl ?? r.logoUrl;
  const closed = !r.availability.open;
  return (
    <span className={`gloss relative block overflow-hidden ${url ? "bg-stone-200" : patternClass(r.name)} ${closed ? "opacity-60 grayscale" : ""} ${className}`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- photos fournies par les partenaires
        <img src={url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <span className="font-display absolute bottom-1.5 right-1.5 rounded-md bg-white/90 px-1.5 text-[12px] font-extrabold text-ink" aria-hidden="true">
          {initials(r.name)}
        </span>
      )}
    </span>
  );
}

// Badge posé sur la photo : livraison offerte ou fermé.
function CoverBadge({ r }: { r: AppRestaurant }) {
  const t = useT();
  if (!r.availability.open) return <span className="absolute bottom-1.5 left-1.5 rounded-md bg-stone-900/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">{t("Fermé")}</span>;
  if (r.deliveryFee === 0) return <span className="absolute bottom-1.5 left-1.5 rounded-md bg-sun px-1.5 py-0.5 text-[11px] font-bold text-ink">{t("Offerte")}</span>;
  return null;
}

// « ★ 4,6 (128) · 20–30 min · 1,2 km » : la note n'apparaît qu'une fois des clients l'ont donnée.
export function Facts({ r, reviews = true }: { r: AppRestaurant; reviews?: boolean }) {
  const position = usePosition();
  const distance = position ? distanceKm(position, r) : null;
  const parts = [
    r.rating ? `★ ${r.rating.avg.toFixed(1).replace(".", ",")}${reviews ? ` (${r.rating.count})` : ""}` : null,
    `${r.deliveryTimeMin}–${r.deliveryTimeMax} min`,
    distance !== null ? km(distance) : null,
  ].filter(Boolean);
  return <span className="block truncate text-[13px] text-stone-500">{parts.join(" · ")}</span>;
}

function Fee({ r }: { r: AppRestaurant }) {
  const t = useT();
  if (!r.availability.open) return <span className="block truncate text-[13px] text-stone-500">{r.availability.reason ?? t("Fermé")}</span>;
  if (r.deliveryFee === null) return null;
  if (r.deliveryFee === 0) return <span className="block text-[13px] font-semibold text-emerald-700">{t("Livraison offerte")}</span>;
  return (
    <span className="block text-[13px] font-semibold text-emerald-700">
      {t("Livraison")} {r.feeFrom ? `${t("dès")} ` : ""}
      {fcfa(r.deliveryFee)}
    </span>
  );
}

// Ligne de la liste (accueil, recherche) : photo carrée avec badge, nom, note, délai, distance et frais.
export function RestaurantCard({ r }: { r: AppRestaurant }) {
  const closed = !r.availability.open;
  return (
    // Pas de préchargement : une requête par carte dès l'ouverture ralentissait l'accueil sur les connexions lentes.
    <Link href={`/r/${r.slug}`} prefetch={false} className="block py-3 transition active:scale-[0.98]">
      <div className="flex gap-3">
        <span className="relative shrink-0">
          <Cover r={r} className="h-[84px] w-[84px] rounded-2xl" />
          <CoverBadge r={r} />
        </span>
        <span className={`min-w-0 flex-1 self-center ${closed ? "text-stone-400" : ""}`}>
          <span className="block truncate text-[17px] font-semibold">{r.name}</span>
          <Facts r={r} />
          <Fee r={r} />
        </span>
      </div>
      {r.dishes.length > 0 && (
        <ul className="mt-2 space-y-1 pl-[96px] text-[15px]">
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

// Carte d'une rangée horizontale de l'accueil (« Livraison rapide », « Près de vous ») : grande photo, nom, note.
export function RestaurantTile({ r }: { r: AppRestaurant }) {
  return (
    <Link href={`/r/${r.slug}`} prefetch={false} className="block w-[196px] shrink-0 snap-start transition active:scale-[0.98]">
      <span className="relative block">
        <Cover r={r} className="h-[112px] w-full rounded-2xl" />
        <CoverBadge r={r} />
      </span>
      <span className="mt-1.5 block truncate text-[15px] font-semibold">{r.name}</span>
      <Facts r={r} reviews={false} />
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
  const t = useT();
  const [label, color] = ORDER_STATUS[status] ?? [status, "bg-stone-100 text-stone-700"];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{t(label)}</span>;
}

export const KIND: Record<HistoryEntry["kind"], { label: string; icon: IconName }> = {
  FOOD: { label: "Repas", icon: "menu" },
  PARCEL: { label: "Colis", icon: "box" },
};

export const dateTime = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });
