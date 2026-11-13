"use client";

import { useEffect, useState } from "react";
import { adminFetch, adminImage, type Driver } from "@/lib/admin";
import { photoDataUrl } from "@/lib/photo";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, input } from "../ui";

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

// Ajout des pièces d'un livreur par l'équipe (directeur ou administrateur adjoint) : seule l'équipe dépose la photo
// de profil, la pièce d'identité (avec ses dates) et le permis. Chaque photo choisie est envoyée ; pour la pièce
// d'identité, les dates suffisent quand la photo reste la même.
export function DocsEditor({ driver, onSaved, onClose }: { driver: Pick<Driver, "id" | "name" | "zedDocuments">; onSaved: () => Promise<unknown> | void; onClose?: () => void }) {
  const t = useT();
  const docs = driver.zedDocuments ?? [];
  const idCard = docs.find((d) => d.kind === "ID_CARD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form
      className="mt-2 space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3"
      aria-label={t("Pièces de {name}", { name: driver.name })}
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const file = (k: string) => {
          const v = f.get(k);
          return v instanceof File && v.size > 0 ? v : null;
        };
        const issuedAt = String(f.get("idIssuedAt") ?? "");
        const expiresAt = String(f.get("idExpiresAt") ?? "");
        const datesChanged = issuedAt !== (idCard?.issuedAt?.slice(0, 10) ?? "") || expiresAt !== (idCard?.expiresAt?.slice(0, 10) ?? "");
        setBusy(true);
        setError(null);
        try {
          for (const k of KINDS) {
            const picked = file(k.kind);
            if (k.kind === "ID_CARD") {
              if (!picked && !(idCard && datesChanged)) continue;
              const body = { issuedAt, expiresAt, ...(picked ? { photo: await photoDataUrl(picked) } : {}) };
              await adminFetch(`/drivers/${driver.id}/documents/ID_CARD`, { method: "PUT", body });
            } else if (picked) {
              await adminFetch(`/drivers/${driver.id}/documents/${k.kind}`, { method: "PUT", body: { photo: await photoDataUrl(picked) } });
            }
          }
          await onSaved();
          if (onClose) onClose();
          else form.reset();
        } catch (err) {
          setError((err as Error).message);
          await onSaved();
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {KINDS.map((k) => {
          const has = docs.some((d) => d.kind === k.kind);
          return (
            <label key={k.kind} className="block text-sm">
              <span className="mb-1 block font-medium">
                {t(k.label)} {has ? <span className="text-xs font-normal text-emerald-700">({t("à remplacer")})</span> : k.required ? <span className="text-xs font-normal text-red-700">({t("à fournir")})</span> : null}
              </span>
              <input name={k.kind} type="file" accept="image/*" className={input} />
            </label>
          );
        })}
      </div>
      <fieldset className="grid grid-cols-2 gap-2">
        <legend className="mb-1 text-sm font-medium">{t("Dates de la pièce d'identité")}</legend>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">{t("Délivrée le")}</span>
          <input name="idIssuedAt" type="date" max={today} defaultValue={idCard?.issuedAt?.slice(0, 10) ?? ""} className={input} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-stone-500">{t("Expire le")}</span>
          <input name="idExpiresAt" type="date" min={today} defaultValue={idCard?.expiresAt?.slice(0, 10) ?? ""} className={input} />
        </label>
      </fieldset>
      <p className="text-xs text-stone-500">{t("Le livreur voit ses pièces dans son profil sans pouvoir les changer. Il est prévenu avant l'expiration de sa pièce d'identité, comme l'équipe.")}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={busy} className={button}>
          {busy ? t("Envoi…") : t("Enregistrer les pièces")}
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className={buttonGhost}>
            {t("Fermer")}
          </button>
        )}
      </div>
    </form>
  );
}

// Pièces du livreur dans la liste de l'admin : miniatures (ouvertes en grand au clic), pièces manquantes et,
// pour le directeur et l'adjoint, l'ajout des pièces.
export function DriverDocs({ driver, showPhotos, onSaved }: { driver: Driver; showPhotos: boolean; onSaved?: () => Promise<unknown> | void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
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
        {showPhotos && onSaved && !editing && (
          <button type="button" onClick={() => setEditing(true)} className={`${buttonGhost} py-1! text-xs`}>
            {missing.length ? t("Ajouter les pièces") : t("Changer les pièces")}
          </button>
        )}
      </span>
      {editing && onSaved && (
        <div className="basis-full">
          <DocsEditor driver={driver} onSaved={onSaved} onClose={() => setEditing(false)} />
        </div>
      )}
    </div>
  );
}
