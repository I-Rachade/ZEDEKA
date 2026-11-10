"use client";

import { useEffect, useRef, useState } from "react";
import { fcfa } from "@/lib/api";
import type { AdminMenuItem, AdminOption } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, ErrorNote, input } from "./ui";
import { photoName, THUMB_SIDE, thumbOf } from "@/lib/media";

// Gestion de la carte (plats, variantes, suppléments), partagée par l'admin et l'espace restaurant.

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;
type Fetcher = (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
export type Upload = (photo: Blob, query?: string) => Promise<string>; // query : « ?thumbOf=<nom> » pour la vignette d'une photo
const text = (v: FormDataEntryValue | null) => (v === null ? "" : String(v).trim());

// Réduit la photo avant l'envoi (1280 px au plus, WebP) : une photo de téléphone de plusieurs Mo devient
// ~140 ko (~200 ko en JPEG), envoyée vite même sur une connexion lente. Les navigateurs qui ne savent pas produire
// du WebP (anciens iPhone : ils rendent alors un PNG) envoient du JPEG. Si le navigateur ne sait pas lire la photo,
// elle part telle quelle.
const MAX_SIDE = 1280;
// Vignettes acceptées par l'API (routes/menuImages.ts).
const SMALL_TYPES = new Set(["image/webp", "image/jpeg"]);
export async function shrink(file: Blob, maxSide = MAX_SIDE): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#fff"; // fond blanc pour les PNG transparents
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const encode = (type: string, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
    const webp = await encode("image/webp", 0.8);
    if (webp?.type === "image/webp") return webp;
    return (await encode("image/jpeg", 0.82)) ?? file;
  } catch {
    return file;
  }
}

// Photos envoyées avant les vignettes : à l'ouverture de la carte (espace restaurant ou admin), chaque photo Zedeka
// sans vignette est relue, réduite et sa vignette envoyée, une à une, sans gêner l'écran. Les clients reçoivent
// ensuite la vignette légère dans la liste des plats (au plus une heure plus tard, le temps du cache).
const backfilled = new Set<string>();
function useThumbBackfill(items: AdminMenuItem[], upload: Upload) {
  const photos = items.map((i) => i.imageUrl).filter((u): u is string => !!u && /\.(jpg|webp)$/.test(photoName(u) ?? ""));
  const key = photos.join(" ");
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const url of photos) {
        if (stop) return;
        if (backfilled.has(url)) continue;
        backfilled.add(url);
        try {
          const probe = await fetch(thumbOf(url), { method: "HEAD", cache: "no-store" });
          if (probe.headers.get("X-Thumb") !== "missing") continue;
          const full = await (await fetch(url)).blob();
          const small = await shrink(full, THUMB_SIDE);
          if (SMALL_TYPES.has(small.type) && small !== full) await upload(small, `?thumbOf=${photoName(url)}`);
        } catch {
          // réseau coupé ou photo illisible : on réessaiera à la prochaine ouverture
          backfilled.delete(url);
        }
      }
    })();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- relancé quand la liste des photos change
  }, [key]);
}

// Labels selon ce qu'on envoie : photo d'un plat ou logo du restaurant.
const LABELS = {
  photo: { alt: "Photo du plat", none: "Sans photo", busy: "Envoi de la photo…", change: "Changer la photo", add: "Ajouter une photo", link: "Lien de la photo (https://…)" },
  logo: { alt: "Logo du restaurant", none: "Sans logo", busy: "Envoi du logo…", change: "Changer le logo", add: "Ajouter un logo", link: "Lien du logo (https://…)" },
} as const;

// Photo d'un plat ou logo d'un restaurant : depuis le téléphone (appareil photo ou galerie) ou l'ordinateur,
// ou un lien en secours. Le lien obtenu part avec le formulaire, dans le champ caché `name` (« imageUrl » par défaut).
export function PhotoField({
  initial,
  upload,
  onBusy,
  name = "imageUrl",
  kind = "photo",
  disabled = false,
  className = "sm:col-span-4",
}: {
  initial: string | null;
  upload: Upload;
  onBusy?: (busy: boolean) => void;
  name?: string;
  kind?: keyof typeof LABELS;
  disabled?: boolean;
  className?: string;
}) {
  const [url, setUrl] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLink, setShowLink] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const t = useT();
  const l = LABELS[kind];
  const logo = kind === "logo";

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    onBusy?.(true);
    try {
      // Un logo s'affiche petit : 512 px suffisent.
      const photo = await upload(await shrink(file, logo ? 512 : MAX_SIDE));
      // Photo de plat : vignette légère pour les listes de la carte (le client télécharge ~30 ko au lieu de ~200 ko
      // par plat). Facultative : en cas d'échec, la photo entière s'affiche à sa place.
      const photoFile = logo ? null : photoName(photo);
      if (photoFile?.endsWith(".jpg")) {
        const small = await shrink(file, THUMB_SIDE);
        if (SMALL_TYPES.has(small.type)) await upload(small, `?thumbOf=${photoFile}`).catch(() => {});
      }
      setUrl(photo);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Envoi impossible"));
    } finally {
      setBusy(false);
      onBusy?.(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const shape = logo ? "rounded-full" : "rounded-lg";
  return (
    <div className={`space-y-2 ${className}`}>
      <input type="hidden" name={name} value={url} />
      <div className="flex flex-wrap items-center gap-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- image fournie par le restaurant
          <img src={url} alt={t(l.alt)} className={`h-16 w-16 shrink-0 object-cover ${shape}`} />
        ) : (
          <div className={`grid h-16 w-16 shrink-0 place-items-center border border-dashed border-stone-300 bg-stone-50 text-[11px] text-stone-400 ${shape}`}>{t(l.none)}</div>
        )}
        {!disabled && (
          <>
            <label className={`${buttonGhost} cursor-pointer ${busy ? "pointer-events-none opacity-60" : ""}`}>
              {busy ? t(l.busy) : url ? t(l.change) : t(l.add)}
              <input ref={fileInput} type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
            </label>
            {url && !busy && (
              <button type="button" onClick={() => setUrl("")} className="text-sm text-red-700">
                {t("Retirer")}
              </button>
            )}
            {!showLink && (
              <button type="button" onClick={() => setShowLink(true)} className="text-sm text-stone-500 underline">
                {t("ou coller un lien")}
              </button>
            )}
          </>
        )}
      </div>
      {showLink && !disabled && <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t(l.link)} className={`${input} w-full`} />}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function ItemOptions({ item, addons, run, reload, fetcher }: { item: AdminMenuItem; addons: AdminOption[]; run: Run; reload: () => Promise<void>; fetcher: Fetcher }) {
  const [variants, setVariants] = useState(item.variants.map((v) => ({ name: v.name, price: String(v.price) })));
  const [addonIds, setAddonIds] = useState(item.addons.map((a) => a.id));
  const t = useT();

  return (
    <div className="mt-2 space-y-3 rounded-lg bg-stone-50 p-3 text-sm">
      <div className="space-y-2">
        <p className="font-medium">{t("Variantes")} {variants.length === 0 && <span className="font-normal text-stone-500">{t("(aucune : prix unique)")}</span>}</p>
        {variants.map((v, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={v.name}
              onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              placeholder={t("Nom (ex. Grande portion)")}
              className={`${input} flex-1`}
            />
            <input
              value={v.price}
              type="number"
              min={0}
              step={50}
              onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
              className={`${input} w-28`}
              aria-label={t("Prix")}
            />
            <button type="button" onClick={() => setVariants((vs) => vs.filter((_, j) => j !== i))} className="px-2 text-red-700" aria-label={t("Supprimer la variante")}>
              ×
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" onClick={() => setVariants((vs) => [...vs, { name: "", price: String(item.price) }])} className={buttonGhost}>
            {t("+ Variante")}
          </button>
          <button
            type="button"
            onClick={() =>
              run(async () => {
                await fetcher(`/items/${item.id}/variants`, {
                  method: "PUT",
                  body: { variants: variants.filter((v) => v.name.trim()).map((v) => ({ name: v.name.trim(), price: Number(v.price) })) },
                });
                await reload();
              })
            }
            className={button}
          >
            {t("Enregistrer les variantes")}
          </button>
        </div>
      </div>

      <div className="space-y-1 border-t border-stone-200 pt-3">
        <p className="font-medium">{t("Suppléments proposés")}</p>
        {addons.length === 0 ? (
          <p className="text-stone-500">{t("Créez d'abord des suppléments plus bas.")}</p>
        ) : (
          addons.map((a) => (
            <label key={a.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={addonIds.includes(a.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...addonIds, a.id] : addonIds.filter((x) => x !== a.id);
                  setAddonIds(next);
                  run(async () => {
                    await fetcher(`/items/${item.id}/addons`, { method: "PUT", body: { addonIds: next } });
                    await reload();
                  });
                }}
              />
              {a.name} (+ {fcfa(a.price)})
            </label>
          ))
        )}
      </div>
    </div>
  );
}

function ItemRow({ item, addons, run, reload, fetcher, upload }: { item: AdminMenuItem; addons: AdminOption[]; run: Run; reload: () => Promise<void>; fetcher: Fetcher; upload: Upload }) {
  const [mode, setMode] = useState<"view" | "edit" | "options">("view");
  const [uploading, setUploading] = useState(false);
  const t = useT();
  const save = (body: Partial<AdminMenuItem>) =>
    run(async () => {
      await fetcher(`/items/${item.id}`, { method: "PATCH", body });
      await reload();
    });
  // « Épuisé » / « Disponible » : le plat change d'aspect dès le geste ; revient si le serveur refuse.
  const [availableNow, setAvailableNow] = useState<boolean | null>(null);
  const available = availableNow ?? item.available;
  const toggleAvailable = async () => {
    setAvailableNow(!available);
    await save({ available: !available });
    setAvailableNow(null);
  };

  if (mode === "edit") {
    return (
      <li className="py-2">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await save({
              category: text(f.get("category")),
              name: text(f.get("name")),
              description: text(f.get("description")) || null,
              price: Number(f.get("price")),
              imageUrl: text(f.get("imageUrl")) || null,
            });
            if (ok) setMode("view");
          }}
          className="grid gap-2 sm:grid-cols-4"
        >
          <input name="category" defaultValue={item.category} required className={input} />
          <input name="name" defaultValue={item.name} required className={input} />
          <input name="description" defaultValue={item.description ?? ""} placeholder={t("Description")} className={input} />
          <input name="price" type="number" min={0} step={50} defaultValue={item.price} required className={input} />
          <PhotoField initial={item.imageUrl} upload={upload} onBusy={setUploading} />
          <div className="flex gap-2 sm:col-span-4">
            <button className={button} disabled={uploading}>
              {t("Enregistrer")}
            </button>
            <button type="button" onClick={() => setMode("view")} className={buttonGhost}>
              {t("Annuler")}
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-2">
        <div className={`flex items-center gap-3 ${available ? "" : "opacity-50"}`}>
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- photo fournie par le restaurant
            <img src={thumbOf(item.imageUrl)} alt={t("Photo : {name}", { name: item.name })} loading="lazy" decoding="async" className="h-12 w-12 rounded object-cover" />
          ) : (
            <button type="button" onClick={() => setMode("edit")} className="grid h-12 w-12 shrink-0 place-items-center rounded border border-dashed border-amber-400 bg-amber-50 text-[11px] font-medium leading-tight text-amber-800">
              {t("+ photo")}
            </button>
          )}
          <div>
            <p className="font-medium">{item.name}</p>
            <p className="text-sm text-stone-500">
              {item.category} · {fcfa(item.price)}
              {item.variants.length > 0 && ` · ${t("{n} variante(s)", { n: item.variants.length })}`}
              {item.addons.length > 0 && ` · ${t("{n} supplément(s)", { n: item.addons.length })}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <button onClick={toggleAvailable} className={buttonGhost}>
            {available ? t("Épuisé") : t("Disponible")}
          </button>
          <button onClick={() => setMode(mode === "options" ? "view" : "options")} className={buttonGhost}>
            {t("Options")}
          </button>
          <button onClick={() => setMode("edit")} className={buttonGhost}>
            {t("Modifier")}
          </button>
        </div>
      </div>
      {mode === "options" && <ItemOptions item={item} addons={addons} run={run} reload={reload} fetcher={fetcher} />}
    </li>
  );
}

export default function MenuEditor({
  items,
  addons,
  fetcher,
  upload,
  base,
  run,
  error,
  reload,
}: {
  items: AdminMenuItem[];
  addons: AdminOption[];
  fetcher: Fetcher;
  upload: (path: string, photo: Blob) => Promise<string>; // envoi d'une photo de plat (adminUploadImage, restaurantUploadImage)
  base: string; // préfixe des créations : « /restaurants/:id » pour l'admin, « » pour le restaurant
  run: Run;
  error: string | null;
  reload: () => Promise<void>;
}) {
  const withoutPhoto = items.filter((i) => !i.imageUrl).length;
  const t = useT();
  const uploadImage: Upload = (photo, query = "") => upload(`${base}/images${query}`, photo);
  useThumbBackfill(items, uploadImage);
  const [uploading, setUploading] = useState(false);
  const [newForm, setNewForm] = useState(0); // remet à zéro la photo après l'ajout d'un plat
  return (
    <>
      <Card title="Carte">
        <ErrorNote message={error} />
        {withoutPhoto > 0 && (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {withoutPhoto === 1 ? t("1 plat n'a pas de photo") : t("{n} plats n'ont pas de photo", { n: withoutPhoto })}. {t("Les plats avec une vraie photo se commandent davantage : touchez « + photo » ou « Modifier » pour en prendre une ou la choisir dans vos images.")}
          </p>
        )}
        <ul className="divide-y divide-stone-100">
          {items.map((item) => <ItemRow key={item.id} item={item} addons={addons} run={run} reload={reload} fetcher={fetcher} upload={uploadImage} />)}
        </ul>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const ok = await run(async () => {
              await fetcher(`${base}/items`, {
                method: "POST",
                body: {
                  category: text(f.get("category")),
                  name: text(f.get("name")),
                  description: text(f.get("description")) || null,
                  price: Number(f.get("price")),
                  imageUrl: text(f.get("imageUrl")) || null,
                  sortOrder: items.length,
                },
              });
              await reload();
            });
            if (ok) {
              form.reset();
              setNewForm((n) => n + 1);
            }
          }}
          className="mt-3 grid gap-2 border-t border-stone-100 pt-3 sm:grid-cols-4"
        >
          <input name="category" required placeholder={t("Catégorie (ex. Plats)")} className={input} />
          <input name="name" required placeholder={t("Nom du plat")} className={input} />
          <input name="description" placeholder={t("Description (facultatif)")} className={input} />
          <input name="price" type="number" min={0} step={50} required placeholder={t("Prix FCFA")} className={input} />
          <PhotoField key={newForm} initial={null} upload={uploadImage} onBusy={setUploading} />
          <button className={`${button} sm:col-span-4`} disabled={uploading}>
            {t("Ajouter le plat")}
          </button>
        </form>
      </Card>

      <Card title="Suppléments">
        <ul className="divide-y divide-stone-100">
          {addons.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <span className={a.available ? "" : "opacity-50"}>
                {a.name} · {fcfa(a.price)}
              </span>
              <button
                onClick={() =>
                  run(async () => {
                    await fetcher(`/addons/${a.id}`, { method: "PATCH", body: { available: !a.available } });
                    await reload();
                  })
                }
                className={buttonGhost}
              >
                {a.available ? t("Épuisé") : t("Disponible")}
              </button>
            </li>
          ))}
        </ul>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const f = new FormData(form);
            const ok = await run(async () => {
              await fetcher(`${base}/addons`, { method: "POST", body: { name: text(f.get("name")), price: Number(f.get("price")) } });
              await reload();
            });
            if (ok) form.reset();
          }}
          className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3"
        >
          <input name="name" required placeholder={t("Supplément (ex. Œuf)")} className={`${input} flex-1`} />
          <input name="price" type="number" min={0} step={50} required placeholder={t("Prix FCFA")} className={`${input} w-32`} />
          <button className={button}>{t("Ajouter")}</button>
        </form>
      </Card>
    </>
  );
}
