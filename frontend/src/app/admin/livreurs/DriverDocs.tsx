"use client";

import { useEffect, useState } from "react";
import { adminImage, type Driver } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";

const KINDS = [
  { kind: "SELFIE", label: "Photo de profil", required: true },
  { kind: "ID_CARD", label: "Pièce d'identité", required: true },
  { kind: "LICENCE", label: "Permis", required: false },
  { kind: "MOTO", label: "Moto", required: false },
] as const;

function Thumb({ driverId, kind, label, at }: { driverId: string; kind: string; label: string; at: string }) {
  const t = useT();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let local: string | null = null;
    adminImage(`/drivers/${driverId}/documents/${kind}`).then((u) => setUrl((local = u)));
    return () => {
      if (local) URL.revokeObjectURL(local);
    };
  }, [driverId, kind, at]);
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" className="block" title={t("{label}, envoyée le {date}", { label: t(label), date: new Date(at).toLocaleDateString("fr-FR") })}>
      <span className="block h-14 w-16 overflow-hidden rounded-lg border border-emerald-600 bg-stone-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url && <img src={url} alt={t(label)} className="h-full w-full object-cover" />}
      </span>
      <span className="block text-center text-[11px] text-stone-600">{t(label)}</span>
    </a>
  );
}

const DAY = 86_400_000;
const longDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// Validité de la pièce d'identité : expirée (rouge), expire dans 30 jours (orange), valable, ou dates non saisies.
export function IdExpiry({ doc }: { doc?: { expiresAt?: string | null } }) {
  const t = useT();
  if (!doc) return null;
  if (!doc.expiresAt) return <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{t("Pièce d'identité sans dates")}</span>;
  const left = new Date(doc.expiresAt).getTime() + DAY - Date.now();
  const date = longDate(doc.expiresAt);
  if (left <= 0) return <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">{t("Pièce d'identité expirée le {date}", { date })}</span>;
  if (left <= 30 * DAY) return <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{t("Pièce d'identité : expire le {date}", { date })}</span>;
  return <span className="rounded-full bg-stone-100 px-2 py-1 text-xs font-medium text-stone-600">{t("Pièce d'identité valable jusqu'au {date}", { date })}</span>;
}

// Pièces du livreur dans la liste de l'admin : miniatures (ouvertes en grand au clic) et pièces manquantes.
export function DriverDocs({ driver, showPhotos }: { driver: Driver; showPhotos: boolean }) {
  const t = useT();
  const docs = driver.zedDocuments ?? [];
  const missing = KINDS.filter((k) => k.required && !docs.some((d) => d.kind === k.kind));
  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      {showPhotos &&
        KINDS.map((k) => {
          const doc = docs.find((d) => d.kind === k.kind);
          return doc ? <Thumb key={k.kind} driverId={driver.id} kind={k.kind} label={k.label} at={doc.createdAt} /> : null;
        })}
      <span className="flex flex-wrap items-center gap-1 pb-4">
        <IdExpiry doc={docs.find((d) => d.kind === "ID_CARD")} />
        {missing.map((k) => (
          <span key={k.kind} className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
            {t("{label} manquante", { label: t(k.label) })}
          </span>
        ))}
        {driver.motorbike ? (
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
            {t("Moto du parc")} {driver.motorbike.plate}
          </span>
        ) : driver.plate ? (
          <span className="rounded-full bg-stone-100 px-2 py-1 font-mono text-xs font-semibold text-stone-700">{driver.plate}</span>
        ) : (
          driver.employment === "FREELANCE" && driver.vehicle === "MOTO" && <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{t("Plaque non saisie")}</span>
        )}
      </span>
    </div>
  );
}
