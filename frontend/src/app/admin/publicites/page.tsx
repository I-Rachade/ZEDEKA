"use client";

import { useRef, useState } from "react";
import { shrink } from "@/components/panel/MenuEditor";
import { adminFetch, adminUploadImage } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Publicités de l'accueil de l'appli client : le carrousel sous « Livrer à ». Image au format 16:7
// (1600 × 700 px conseillé), lien facultatif, ordre d'affichage, masquage et période d'affichage.

type Ad = { id: string; title: string; imageUrl: string; linkUrl: string | null; position: number; active: boolean; startsAt: string | null; endsAt: string | null };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
// Fin incluse : une publicité « jusqu'au 30 » reste visible toute la journée du 30 (heure de Lomé = UTC).
const startOf = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : null);
const endOf = (d: string) => (d ? new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString() : null);
const endDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 86_400_000).toISOString().slice(0, 10) : "");

function status(ad: Ad, t: ReturnType<typeof useT>) {
  const now = Date.now();
  if (!ad.active) return { label: t("Masquée"), tone: "bg-stone-200 text-stone-700" };
  if (ad.startsAt && new Date(ad.startsAt).getTime() > now) return { label: t("Programmée"), tone: "bg-amber-100 text-amber-900" };
  if (ad.endsAt && new Date(ad.endsAt).getTime() <= now) return { label: t("Terminée"), tone: "bg-stone-200 text-stone-700" };
  return { label: t("En ligne"), tone: "bg-emerald-100 text-emerald-800" };
}

// Format attendu par le carrousel de l'accueil : bannière paysage 16:7, affichée en entier sur toute la largeur.
const RATIO = 16 / 7;
const MIN_WIDTH = 1200;

function FormatHint({ size }: { size: { w: number; h: number } | null }) {
  const t = useT();
  const ratio = size ? size.w / size.h : null;
  const offRatio = ratio !== null && Math.abs(ratio - RATIO) / RATIO > 0.06;
  const small = size !== null && size.w < MIN_WIDTH;
  return (
    <div className="max-w-md space-y-1 rounded-xl bg-emerald-50 p-3 text-emerald-950">
      <p className="font-semibold">{t("Format idéal de l'image")}</p>
      <ul className="list-disc space-y-0.5 pl-5">
        <li>{t("1600 × 700 pixels (paysage, rapport 16:7). Au moins 1200 × 525 px.")}</li>
        <li>{t("JPG ou PNG, 5 Mo au plus. L'image est réduite automatiquement à l'envoi.")}</li>
        <li>{t("Textes et logos au centre, avec une marge de 60 px sur les bords ; texte assez gros pour un téléphone.")}</li>
      </ul>
      {size && (
        <p className={offRatio || small ? "font-medium text-amber-800" : "text-emerald-800"}>
          {t("Image actuelle : {w} × {h} px.", { w: size.w, h: size.h })}{" "}
          {offRatio
            ? t("Le rapport n'est pas 16:7 : les bords seront coupés sur l'accueil (voir l'aperçu).")
            : small
              ? t("Image un peu petite : elle risque d'être floue sur les grands écrans.")
              : t("Format parfait.")}
        </p>
      )}
    </div>
  );
}

function AdForm({ ad, nextPosition, onSubmit, onCancel }: { ad?: Ad; nextPosition: number; onSubmit: (body: Partial<Ad>) => Promise<boolean>; onCancel?: () => void }) {
  const [imageUrl, setImageUrl] = useState(ad?.imageUrl ?? "");
  const [busy, setBusy] = useState(false);
  // Taille réelle de l'image choisie, pour prévenir si elle sera rognée ou floue dans le carrousel.
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const t = useT();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setBusy(true);
    try {
      setImageUrl(await adminUploadImage("/ads/images", await shrink(file, 1600)));
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("Envoi impossible"));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const ok = await onSubmit({
          title: String(f.get("title")).trim(),
          imageUrl,
          linkUrl: String(f.get("linkUrl")).trim() || null,
          position: Number(f.get("position") || 0),
          startsAt: startOf(String(f.get("startsAt"))),
          endsAt: endOf(String(f.get("endsAt"))),
        });
        if (ok && !ad) {
          form.reset();
          setImageUrl("");
        }
      }}
      className="grid gap-3 text-sm sm:grid-cols-2"
    >
      <div className="space-y-2 sm:col-span-2">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- aperçu de la bannière
          <img
            src={imageUrl}
            alt=""
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="aspect-[16/7] w-full max-w-md rounded-xl object-cover"
          />
        ) : (
          <div className="grid aspect-[16/7] w-full max-w-md place-items-center rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 text-center text-stone-500">
            {t("Image 16:7 (1600 × 700 px conseillé)")}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${buttonGhost} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
            {busy ? t("Envoi de l'image…") : imageUrl ? t("Changer l'image") : t("Choisir l'image")}
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          <input type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder={t("ou lien de l'image (https://…)")} className={`${input} min-w-0 flex-1`} />
        </div>
        {uploadError && <p className="text-red-700">{uploadError}</p>}
        <FormatHint size={imageUrl ? size : null} />
      </div>
      <label className="space-y-1">
        <span className="block text-stone-600">{t("Nom (lu aussi par les lecteurs d'écran)")}</span>
        <input name="title" required minLength={2} maxLength={80} defaultValue={ad?.title} placeholder={t("ex. Promo Chez Ama -20 %")} className={input} />
      </label>
      <label className="space-y-1">
        <span className="block text-stone-600">{t("Lien au toucher (facultatif)")}</span>
        <input name="linkUrl" defaultValue={ad?.linkUrl ?? ""} placeholder={t("/r/chez-ama ou https://…")} className={input} />
      </label>
      <label className="space-y-1">
        <span className="block text-stone-600">{t("Ordre (plus petit = en premier)")}</span>
        <input name="position" type="number" min={0} max={999} defaultValue={ad?.position ?? nextPosition} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="block text-stone-600">{t("Du (facultatif)")}</span>
          <input name="startsAt" type="date" defaultValue={day(ad?.startsAt ?? null)} className={input} />
        </label>
        <label className="space-y-1">
          <span className="block text-stone-600">{t("Au (inclus)")}</span>
          <input name="endsAt" type="date" defaultValue={endDay(ad?.endsAt ?? null)} className={input} />
        </label>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button className={button} disabled={busy || !imageUrl}>
          {ad ? t("Enregistrer") : t("Ajouter la publicité")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Annuler")}
          </button>
        )}
      </div>
    </form>
  );
}

export default function AdsPage() {
  const { data, error, reload } = useAdmin<Ad[]>("/ads");
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const t = useT();
  const nextPosition = data?.length ? Math.max(...data.map((a) => a.position)) + 1 : 1;

  const save = (id: string, body: Partial<Ad>) =>
    action.run(async () => {
      await adminFetch(`/ads/${id}`, { method: "PATCH", body });
      await reload();
      setEditing(null);
    });

  return (
    <div className="space-y-4">
      <PageHeader
        icon="globe"
        title="Publicités"
        count={data?.length}
        description="Bannières de l'accueil de l'appli client, en carrousel sous « Livrer à ». Elles défilent toutes les 5 secondes dans l'ordre choisi. Sans publicité en ligne, une bannière Zedeka occupe la place."
      />
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <Card title="Publicités">
            {data.length === 0 ? (
              <Empty>Aucune publicité pour le moment</Empty>
            ) : (
              <ul className="divide-y divide-stone-100">
                {data.map((ad) => {
                  const s = status(ad, t);
                  return editing === ad.id ? (
                    <li key={ad.id} className="py-3">
                      <AdForm ad={ad} nextPosition={nextPosition} onSubmit={(b) => save(ad.id, b)} onCancel={() => setEditing(null)} />
                    </li>
                  ) : (
                    <li key={ad.id} className="flex flex-wrap items-center gap-3 py-3">
                      {/* eslint-disable-next-line @next/next/no-img-element -- bannière envoyée dans l'admin */}
                      <img src={ad.imageUrl} alt="" className={`aspect-[16/7] w-40 shrink-0 rounded-lg object-cover ${s.label === t("En ligne") ? "" : "opacity-50"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          <span className="text-stone-400">#{ad.position}</span> <span>{ad.title}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.tone}`}>{s.label}</span>
                        </p>
                        <p className="truncate text-sm text-stone-500">{ad.linkUrl ?? t("Sans lien")}</p>
                        {(ad.startsAt || ad.endsAt) && (
                          <p className="text-sm text-stone-500">
                            {ad.startsAt ? t("du {d}", { d: day(ad.startsAt) }) : ""} {ad.endsAt ? t("au {d}", { d: endDay(ad.endsAt) }) : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setEditing(ad.id)} className={buttonGhost}>
                          {t("Modifier")}
                        </button>
                        <button onClick={() => save(ad.id, { active: !ad.active })} className={buttonGhost}>
                          {ad.active ? t("Masquer") : t("Afficher")}
                        </button>
                        <button
                          onClick={() =>
                            window.confirm(t("Supprimer la publicité « {title} » ?", { title: ad.title })) &&
                            action.run(async () => {
                              await adminFetch(`/ads/${ad.id}`, { method: "DELETE" });
                              await reload();
                            })
                          }
                          className={`${buttonGhost} text-red-700`}
                        >
                          {t("Supprimer")}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card title="Nouvelle publicité">
            <AdForm
              nextPosition={nextPosition}
              onSubmit={(body) =>
                action.run(async () => {
                  await adminFetch("/ads", { method: "POST", body });
                  await reload();
                })
              }
            />
          </Card>
        </>
      )}
    </div>
  );
}
