"use client";

import Link from "next/link";
import { card } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/client";
import { PARCEL_STATUS, type MerchantParcel, type ParcelStatus } from "@/lib/merchant";

// Briques de l'appli marchand, au style des autres applis (cartes blanches, verre, vert profond et brillant).

export function ParcelStatusPill({ status }: { status: ParcelStatus }) {
  const t = useT();
  const [label, color] = PARCEL_STATUS[status];
  return <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${color}`}>{t(label)}</span>;
}

// Grande carte verte en haut de l'accueil et de l'argent : aplat vert de la marque (comme l'en-tête des
// maquettes), filet jaune en bas, angles droits.
export function Hero({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`border-b-4 border-sun bg-emerald-600 p-5 text-white ${className}`}>{children}</div>;
}

export const shortDate = (iso: string, locale: string) =>
  new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });

export function ParcelRow({ p }: { p: MerchantParcel }) {
  const t = useT();
  const { locale } = useI18n();
  return (
    <Link href={`/marchand/colis/${p.code}`} className={`${card} card-line flex items-center gap-3 p-4 transition active:scale-[0.98]`}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-sun-soft text-ink-deep">
        <Icon name="box" className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[16px] font-semibold">{p.recipientName}</span>
          <ParcelStatusPill status={p.status} />
        </span>
        <span className="block truncate text-[13px] text-stone-500">
          {p.code}
          {p.merchantRef ? ` · ${p.merchantRef}` : ""} · {shortDate(p.createdAt, locale)}
        </span>
        <span className="mt-1 flex gap-3 text-[13px] text-stone-600">
          {p.codAmount > 0 ? (
            <span>
              {t("À encaisser")} <strong className="text-ink">{fcfa(p.total)}</strong>
            </span>
          ) : (
            <span>{t("Déjà payé")}</span>
          )}
          <span>
            {t("Livraison")} {fcfa(p.fees)}
            {p.payer === "RECIPIENT" ? ` (${t("destinataire")})` : ""}
          </span>
        </span>
      </span>
      <Icon name="chevron" className="h-4 w-4 shrink-0 text-stone-300" />
    </Link>
  );
}
