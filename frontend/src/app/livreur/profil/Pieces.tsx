"use client";

import { useEffect, useRef, useState } from "react";
import { IdDatesFields, idCardOf } from "../zed/ZedForms";
import { Icon } from "@/components/panel/icons";
import { card, input, primary } from "@/app/app/ui";
import { driverFetch, driverImage, type DriverKit, type ZedDocumentKind } from "@/lib/driver";
import { photoDataUrl } from "@/lib/photo";
import { useT } from "@/lib/i18n/client";

const PAPERS: { kind: ZedDocumentKind; label: string; hint: string; required: boolean }[] = [
  { kind: "SELFIE", label: "Photo de profil", hint: "Visage bien visible, montrée au client", required: true },
  { kind: "ID_CARD", label: "Pièce d'identité", hint: "Carte d'identité ou passeport", required: true },
  { kind: "LICENCE", label: "Permis de conduire", hint: "Facultatif", required: false },
];

// Photo protégée chargée avec le jeton du livreur ; rechargée quand la pièce change.
function usePhoto(path: string | null, version: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path || !version) return;
    let local: string | null = null;
    let live = true;
    driverImage(path).then((u) => {
      local = u;
      if (live) setUrl(u);
    });
    return () => {
      live = false;
      if (local) URL.revokeObjectURL(local);
    };
  }, [path, version]);
  return version ? url : null;
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

// État de la pièce d'identité : valable, bientôt expirée, expirée, ou dates à indiquer.
function IdCardStatus({ doc }: { doc?: DriverKit["documents"][number] }) {
  const t = useT();
  if (!doc) return null;
  const date = doc.expiresAt ? longDate(doc.expiresAt) : "";
  const [tone, text] =
    doc.status === "EXPIRED"
      ? ["bg-red-50 text-red-800", t("Pièce d'identité expirée le {date}. Envoyez la nouvelle avec ses dates.", { date })]
      : doc.status === "SOON"
        ? ["bg-amber-50 text-amber-900", t("Votre pièce d'identité expire le {date}. Pensez à la renouveler.", { date })]
        : doc.status === "NO_DATES"
          ? ["bg-red-50 text-red-800", t("Indiquez les dates de délivrance et d'expiration de votre pièce d'identité.")]
          : ["bg-emerald-50 text-emerald-900", t("Pièce d'identité valable jusqu'au {date}.", { date })];
  return <p className={`rounded-xl p-3 text-sm font-medium ${tone}`}>{text}</p>;
}

function PaperTile({ kind, label, hint, required, updatedAt, onPick, busy }: { kind: ZedDocumentKind; label: string; hint: string; required: boolean; updatedAt?: string; onPick: (file: File) => void; busy: boolean }) {
  const t = useT();
  const src = usePhoto(`/documents/${kind}`, updatedAt);
  const missing = !updatedAt;
  return (
    <li>
      <label className={`relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 p-2 text-center text-xs ${missing ? (required ? "border-dashed border-red-300 bg-red-50" : "border-dashed border-stone-300 bg-surface") : "border-emerald-600"}`}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <Icon name={busy ? "clock" : "plus"} className="h-6 w-6 text-stone-400" />
        )}
        <span className={`relative rounded-full px-2 py-1 font-semibold ${missing ? (required ? "text-red-700" : "text-stone-600") : "bg-emerald-600 text-white"}`}>
          {!missing && "✓ "}
          {t(label)}
        </span>
        {missing && <span className="relative text-[11px] text-stone-500">{required ? t("À fournir") : t(hint)}</span>}
        <input
          type="file"
          accept="image/*"
          capture={kind === "SELFIE" ? "user" : "environment"}
          className="sr-only"
          aria-label={updatedAt ? t("Changer : {label}", { label: t(label) }) : t(label)}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onPick(file);
          }}
        />
      </label>
      {!missing && <p className="mt-1 text-center text-[11px] text-stone-500">{t("Touchez pour changer")}</p>}
    </li>
  );
}

// Profil : pièces du livreur (photo de profil, pièce d'identité, permis) et sa moto (plaque et photo, ou moto du parc).
export function DriverPapers({ kit, setKit }: { kit: DriverKit | null; setKit: (k: DriverKit) => void }) {
  const t = useT();
  const [busy, setBusy] = useState<ZedDocumentKind | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const updated = (kind: ZedDocumentKind) => kit?.documents.find((d) => d.kind === kind)?.updatedAt;

  const datesForm = useRef<HTMLFormElement>(null);
  const idCard = kit?.documents.find((d) => d.kind === "ID_CARD");
  // Pièce d'identité : envoyée avec ses dates, saisies juste en dessous.
  const idDates = () => (datesForm.current ? idCardOf(new FormData(datesForm.current)) : { issuedAt: "", expiresAt: "" });

  async function upload(kind: ZedDocumentKind, file: File) {
    const dates = kind === "ID_CARD" ? idDates() : {};
    if (kind === "ID_CARD" && (!idDates().issuedAt || !idDates().expiresAt)) {
      setNote({ ok: false, text: t("Indiquez d'abord les dates de délivrance et d'expiration de votre pièce, puis ajoutez la photo.") });
      datesForm.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    setBusy(kind);
    setNote(null);
    try {
      const photo = await photoDataUrl(file);
      setKit(await driverFetch<DriverKit>(`/documents/${kind}`, { method: "PUT", body: { photo, ...dates } }));
      setNote({ ok: true, text: t("Photo enregistrée.") });
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message || t("Photo illisible, réessayez.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <section className={`${card} space-y-3 p-4`} aria-labelledby="pieces">
        <div className="flex items-center justify-between gap-2">
          <h2 id="pieces" className="font-semibold">
            {t("Mes pièces")}
          </h2>
          {kit && (kit.missing.length ? <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-700">{t("{n} à fournir", { n: kit.missing.length })}</span> : <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">{t("Complet")}</span>)}
        </div>
        <ul className="grid grid-cols-2 gap-2">
          {PAPERS.map((p) => (
            <PaperTile key={p.kind} {...p} updatedAt={updated(p.kind)} busy={busy === p.kind} onPick={(f) => upload(p.kind, f)} />
          ))}
        </ul>
        <IdCardStatus doc={idCard} />
        <form
          ref={datesForm}
          key={`${idCard?.issuedAt ?? ""}-${idCard?.expiresAt ?? ""}`}
          className="space-y-2 rounded-xl bg-stone-50 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy("ID_CARD");
            setNote(null);
            try {
              setKit(await driverFetch<DriverKit>("/documents/ID_CARD", { method: "PUT", body: idDates() }));
              setNote({ ok: true, text: t("Dates enregistrées.") });
            } catch (err) {
              setNote({ ok: false, text: (err as Error).message });
            } finally {
              setBusy(null);
            }
          }}
        >
          <IdDatesFields issuedAt={idCard?.issuedAt} expiresAt={idCard?.expiresAt} />
          {idCard && (
            <button disabled={busy === "ID_CARD"} className={`${primary} py-2!`}>
              {t("Enregistrer les dates")}
            </button>
          )}
        </form>
        <p className="text-xs text-stone-500">{t("Votre photo de profil est montrée au client pendant la livraison. La pièce d'identité et le permis ne sont vus que par l'équipe Zedeka.")}</p>
        {note && <p className={`text-sm ${note.ok ? "text-emerald-700" : "text-red-700"}`}>{note.text}</p>}
      </section>
      {kit && <MyMoto kit={kit} setKit={setKit} busy={busy === "MOTO"} upload={(f) => upload("MOTO", f)} updatedAt={updated("MOTO")} />}
    </>
  );
}

function MyMoto({ kit, setKit, busy, upload, updatedAt }: { kit: DriverKit; setKit: (k: DriverKit) => void; busy: boolean; upload: (f: File) => void; updatedAt?: string }) {
  const t = useT();
  const [plate, setPlate] = useState(kit.plate ?? "");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const bikePhoto = usePhoto(kit.motorbike?.hasPhoto ? `/motorbikes/${kit.motorbike.id}/photo` : null, kit.motorbike?.id);

  // Salarié : la moto est celle du parc qu'il a prise en commençant son service.
  if (!kit.canEditPlate) {
    return (
      <section className={`${card} space-y-3 p-4`}>
        <h2 className="font-semibold">{t("Ma moto")}</h2>
        {kit.motorbike ? (
          <div className="flex items-center gap-3">
            <span className="grid h-16 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-stone-100">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {bikePhoto ? <img src={bikePhoto} alt="" className="h-full w-full object-cover" /> : <Icon name="rider" className="h-7 w-7 text-stone-400" />}
            </span>
            <div>
              <p className="font-mono text-lg font-bold tracking-wide">{kit.motorbike.plate}</p>
              {kit.motorbike.label && <p className="text-sm text-stone-600">{kit.motorbike.label}</p>}
              <p className="text-xs text-stone-500">{t("Moto du parc Zedeka. Elle est rendue quand vous passez hors ligne.")}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-600">{kit.needsMotorbike ? t("Vous choisirez une moto du parc Zedeka en passant en ligne.") : t("Aucune moto du parc pour le moment. La répartition vous en attribue une.")}</p>
        )}
      </section>
    );
  }

  return (
    <section className={`${card} space-y-3 p-4`}>
      <h2 className="font-semibold">{t("Ma moto")}</h2>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setNote(null);
          try {
            const next = await driverFetch<DriverKit>("/plate", { method: "PATCH", body: { plate } });
            setKit(next);
            setPlate(next.plate ?? "");
            setNote({ ok: true, text: t("Plaque enregistrée.") });
          } catch (err) {
            setNote({ ok: false, text: (err as Error).message });
          } finally {
            setSaving(false);
          }
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("Plaque d'immatriculation")}</span>
          <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder={t("Plaque, ex. TG-1234-AB")} maxLength={20} className={`${input} font-mono uppercase`} />
        </label>
        <button disabled={saving || plate.trim().length < 3 || plate.trim() === (kit.plate ?? "")} className={`${primary} w-auto! px-4`}>
          {saving ? "…" : t("Enregistrer")}
        </button>
      </form>
      <p className="text-xs text-stone-500">{t("Le client voit cette plaque pour reconnaître votre moto. Changez-la si vous changez de moto.")}</p>
      <ul className="grid grid-cols-2 gap-2">
        <PaperTile kind="MOTO" label="Photo de la moto" hint="Avec la plaque visible" required={false} updatedAt={updatedAt} busy={busy} onPick={upload} />
      </ul>
      {note && <p className={`text-sm ${note.ok ? "text-emerald-700" : "text-red-700"}`}>{note.text}</p>}
    </section>
  );
}

// Photo de profil du livreur (avatar), si elle est fournie.
export function useProfilePhoto(kit: DriverKit | null) {
  return usePhoto("/documents/SELFIE", kit?.documents.find((d) => d.kind === "SELFIE")?.updatedAt);
}
