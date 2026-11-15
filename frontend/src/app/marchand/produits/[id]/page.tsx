"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { askConfirm } from "@/components/AlertDialog";
import { card, input, primary, Skeleton, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { shrink } from "@/components/panel/MenuEditor";
import { useT } from "@/lib/i18n/client";
import { photoName, THUMB_SIDE, thumbOf } from "@/lib/media";
import { merchantFetch, merchantUpload, REVIEW_STATUS, type Product, type StoreState } from "@/lib/merchant";

const MAX_PHOTOS = 5;
type OptionRow = { name: string; values: string };

// Ajouter ou modifier un produit : photos (5 au plus), nom, prix, stock, rayon, tailles ou couleurs, description.
export default function ProductForm() {
  const t = useT();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const creating = id === "nouveau";
  const [loaded, setLoaded] = useState<Product | null>(null);
  const [sections, setSections] = useState<string[]>([]);
  const [reviewedFirst, setReviewedFirst] = useState(5);
  const [photos, setPhotos] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("1");
  const [section, setSection] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [list, state] = await Promise.all([merchantFetch<Product[]>("/products"), merchantFetch<StoreState>("/store")]);
        setSections([...new Set(list.map((p) => p.section).filter(Boolean))]);
        if ("reviewedFirst" in state) setReviewedFirst(state.reviewedFirst);
        if (creating) return;
        const p = list.find((x) => x.id === id);
        if (!p) throw new Error(t("Produit introuvable"));
        setLoaded(p);
        setPhotos(p.imageUrls);
        setName(p.name);
        setPrice(String(p.price));
        setStock(String(p.stock));
        setSection(p.section);
        setDescription(p.description ?? "");
        setOptions(p.options.map((o) => ({ name: o.name, values: o.values.join(", ") })));
        setVisible(p.visible);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [creating, id, t]);

  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      for (const file of [...files].slice(0, MAX_PHOTOS - photos.length)) {
        const url = await merchantUpload("/store/images", await shrink(file));
        // Vignette légère pour les listes, comme pour les plats (facultative).
        const own = photoName(url);
        if (own?.endsWith(".jpg")) {
          const small = await shrink(file, THUMB_SIDE);
          await merchantUpload("/store/images", small, `?thumbOf=${own}`).catch(() => {});
        }
        setPhotos((ps) => [...ps, url].slice(0, MAX_PHOTOS));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name,
      price: Number(price.replace(/\s/g, "")),
      stock: Number(stock),
      section: section.trim(),
      description: description.trim(),
      imageUrls: photos,
      visible,
      options: options
        .map((o) => ({ name: o.name.trim(), values: o.values.split(",").map((v) => v.trim()).filter(Boolean) }))
        .filter((o) => o.name && o.values.length),
    };
    try {
      await merchantFetch(creating ? "/products" : `/products/${id}`, { method: creating ? "POST" : "PATCH", body });
      router.replace("/marchand/produits");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!(await askConfirm(t("Supprimer ce produit de votre boutique ?"), t("Supprimer")))) return;
    try {
      await merchantFetch(`/products/${id}`, { method: "DELETE" });
      router.replace("/marchand/produits");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!creating && !loaded && !error) {
    return (
      <div>
        <TopBar title="Produit" back="/marchand/produits" />
        <div className="p-4">
          <Skeleton rows={4} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopBar title={creating ? "Nouveau produit" : "Modifier le produit"} back="/marchand/produits" />
      <form onSubmit={save} className="space-y-4 px-4 pb-8 pt-4">
        {loaded && loaded.review !== "APPROVED" && (
          <p className={`rounded-xl p-3 text-[14px] ${loaded.review === "REJECTED" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
            <strong>{t(REVIEW_STATUS[loaded.review][0])}</strong>
            {loaded.review === "REJECTED" && loaded.reviewNote ? ` : ${loaded.reviewNote}` : ` : ${t("l'équipe Zedeka vérifie ce produit avant qu'il soit visible.")}`}
          </p>
        )}

        <section className={`${card} card-line space-y-3 p-4`}>
          <p className="text-[12px] uppercase tracking-wide text-stone-500">{t("Photos ({n} au plus)", { n: MAX_PHOTOS })}</p>
          <div className="flex flex-wrap gap-2">
            {photos.map((url, i) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand */}
                <img src={thumbOf(url)} alt={t("Photo {n}", { n: i + 1 })} className="h-20 w-20 rounded-[10px] object-cover" />
                {i === 0 && <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{t("Principale")}</span>}
                <button
                  type="button"
                  onClick={() => setPhotos((ps) => ps.filter((x) => x !== url))}
                  aria-label={t("Retirer la photo {n}", { n: i + 1 })}
                  className="keep-round absolute -right-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-white text-red-600 shadow"
                >
                  <Icon name="close" className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label className={`grid h-20 w-20 cursor-pointer place-items-center rounded-[10px] border-2 border-dashed border-stone-300 text-center text-[11px] text-stone-500 ${uploading ? "opacity-50" : ""}`}>
                {uploading ? t("Envoi…") : (
                  <span className="flex flex-col items-center gap-1">
                    <Icon name="plus" className="h-5 w-5" />
                    {t("Photo")}
                  </span>
                )}
                <input ref={fileInput} type="file" accept="image/*" multiple className="sr-only" disabled={uploading} onChange={(e) => addPhotos(e.target.files)} aria-label={t("Ajouter des photos")} />
              </label>
            )}
          </div>
        </section>

        <section className={`${card} card-line space-y-3 p-4`}>
          <Field label="Nom du produit">
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder={t("Ex. Robe wax longue")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prix (FCFA)">
              <input className={input} value={price} onChange={(e) => setPrice(e.target.value)} required inputMode="numeric" placeholder="12500" />
            </Field>
            <Field label="Stock">
              <input className={input} value={stock} onChange={(e) => setStock(e.target.value)} required type="number" min={0} inputMode="numeric" />
            </Field>
          </div>
          <Field label="Rayon de la boutique">
            <input className={input} value={section} onChange={(e) => setSection(e.target.value)} maxLength={40} list="rayons" placeholder={t("Ex. Robes, Sacs, Chaussures")} />
            <datalist id="rayons">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>
          <Field label="Description">
            <textarea className={`${input} min-h-24`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder={t("Matière, taille, entretien…")} />
          </Field>
        </section>

        <section className={`${card} card-line space-y-3 p-4`}>
          <div>
            <p className="text-[17px] font-bold">{t("Tailles, couleurs…")}</p>
            <p className="text-[13px] text-stone-500">{t("Facultatif. Le client choisit avant d'ajouter au panier.")}</p>
          </div>
          {options.map((o, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={`${input} !w-28`}
                value={o.name}
                onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                maxLength={20}
                placeholder={t("Taille")}
                aria-label={t("Nom du choix {n}", { n: i + 1 })}
              />
              <input
                className={input}
                value={o.values}
                onChange={(e) => setOptions((os) => os.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))}
                placeholder="S, M, L, XL"
                aria-label={t("Valeurs du choix {n}", { n: i + 1 })}
              />
              <button type="button" onClick={() => setOptions((os) => os.filter((_, j) => j !== i))} className="px-1 text-red-600" aria-label={t("Retirer le choix {n}", { n: i + 1 })}>
                <Icon name="trash" className="h-5 w-5" />
              </button>
            </div>
          ))}
          {options.length < 3 && (
            <button
              type="button"
              onClick={() => setOptions((os) => [...os, { name: os.length === 0 ? t("Taille") : os.length === 1 ? t("Couleur") : "", values: "" }])}
              className="flex items-center gap-1 text-[15px] font-semibold text-emerald-700"
            >
              <Icon name="plus" className="h-4 w-4" /> {t("Ajouter un choix")}
            </button>
          )}
        </section>

        <label className={`${card} card-line flex items-center justify-between gap-3 p-4`}>
          <span>
            <span className="block font-semibold">{t("Visible dans la boutique")}</span>
            <span className="block text-[13px] text-stone-500">{t("Décochez pour cacher le produit sans le supprimer.")}</span>
          </span>
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="h-6 w-6 accent-emerald-600" />
        </label>

        {creating && <p className="rounded-xl bg-sun-soft p-3 text-[13px] text-ink-deep">{t("Vos {n} premiers produits sont vérifiés par Zedeka, ensuite ils sont publiés directement.", { n: reviewedFirst })}</p>}
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || uploading} className={primary}>
          {busy ? t("Enregistrement…") : t("Enregistrer")}
        </button>
        {!creating && (
          <button type="button" onClick={remove} className="w-full rounded-2xl py-3 text-[17px] font-semibold text-red-600 active:bg-red-50">
            {t("Supprimer le produit")}
          </button>
        )}
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] uppercase tracking-wide text-stone-500">{t(label)}</span>
      {children}
    </label>
  );
}
