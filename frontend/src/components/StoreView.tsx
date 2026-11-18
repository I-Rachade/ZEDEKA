"use client";

import { useEffect, useMemo, useState } from "react";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { thumbOf } from "@/lib/media";
import StoreCarousel, { type CarouselBanner } from "./StoreCarousel";

// Page d'une boutique telle que la voit le client : carrousel de bannières (images et vidéos), logo, nom,
// catégorie, rayons et grille de produits ; un produit s'ouvre en fiche (photos, choix de taille ou couleur).
// Utilisée par l'aperçu de l'appli marchand, et par la page publique quand la vente sera ouverte.

export type StoreViewProduct = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  section: string;
  options: { name: string; values: string[] }[];
  imageUrls: string[];
};
export type StoreViewData = {
  name: string;
  area: string;
  category: { label: string; emoji: string } | null;
  description: string | null;
  logoUrl: string | null;
  verified: boolean;
  banners: CarouselBanner[];
  products: StoreViewProduct[];
};

export default function StoreView({ store, action }: { store: StoreViewData; action?: (p: StoreViewProduct, choice: Record<string, string>) => React.ReactNode }) {
  const t = useT();
  const [section, setSection] = useState<string | null>(null);
  const [open, setOpen] = useState<StoreViewProduct | null>(null);
  // Lien direct vers un produit (?produit=<id>, depuis une vidéo « Nouveautés ») : sa fiche s'ouvre tout de suite.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("produit");
    const p = wanted ? store.products.find((x) => x.id === wanted) : undefined;
    if (p) setOpen(p);
  }, [store.products]);
  const sections = useMemo(() => [...new Set(store.products.map((p) => p.section).filter(Boolean))], [store.products]);
  const shown = store.products.filter((p) => !section || p.section === section);

  return (
    <div className="space-y-4">
      {store.banners.length > 0 && (
        <div className="px-4 pt-3">
          <StoreCarousel banners={store.banners} onOpen={(b) => setOpen(store.products.find((p) => p.id === b.productId) ?? null)} />
        </div>
      )}
      <header className="flex items-center gap-3 px-4">
        {store.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo envoyé par le marchand
          <img src={store.logoUrl} alt="" className="keep-round h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
        ) : (
          <span className="keep-round grid h-14 w-14 shrink-0 place-items-center rounded-full bg-emerald-50 text-[26px]">{store.category?.emoji ?? "🛍️"}</span>
        )}
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[22px] font-bold leading-tight">
            <span className="truncate">{store.name}</span>
            {store.verified && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">✓ {t("Vérifiée")}</span>}
          </h2>
          <p className="truncate text-[13px] text-stone-500">
            {store.category ? t(store.category.label) : t("Boutique")} · {store.area}
          </p>
        </div>
      </header>
      {store.description && <p className="px-4 text-[14px] text-stone-600">{store.description}</p>}

      {sections.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
          {[null, ...sections].map((s) => (
            <button
              key={s ?? "all"}
              type="button"
              aria-pressed={section === s}
              onClick={() => setSection(s)}
              className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[14px] font-medium ${section === s ? "bg-ink text-white" : "bg-stone-100 text-stone-700"}`}
            >
              {s ?? t("Tout")}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="mx-4 rounded-2xl bg-stone-100 p-6 text-center text-[14px] text-stone-600">{t("Aucun produit visible pour l'instant.")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 px-4 pb-6">
          {shown.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => setOpen(p)} className={`block w-full overflow-hidden rounded-[12px] bg-surface text-left shadow-[0_1px_3px_rgb(0_0_0/0.1)] active:scale-[0.98] ${p.stock <= 0 ? "opacity-55" : ""}`}>
                <span className="block aspect-square w-full overflow-hidden bg-stone-100">
                  {p.imageUrls[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand
                    <img src={thumbOf(p.imageUrls[0])} alt="" loading="lazy" className="block h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-[32px]">🛍️</span>
                  )}
                </span>
                <span className="block p-2.5">
                  <span className="line-clamp-2 text-[14px] font-medium leading-snug">{p.name}</span>
                  <span className="mt-1 block text-[15px] font-bold text-emerald-700">{p.stock <= 0 ? <span className="text-stone-500">{t("Épuisé")}</span> : fcfa(p.price)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && <ProductSheet product={open} onClose={() => setOpen(null)} action={action} />}
    </div>
  );
}

function ProductSheet({ product: p, onClose, action }: { product: StoreViewProduct; onClose: () => void; action?: (p: StoreViewProduct, choice: Record<string, string>) => React.ReactNode }) {
  const t = useT();
  const [photo, setPhoto] = useState(0);
  const [choice, setChoice] = useState<Record<string, string>>({});
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={p.name} onClick={(e) => e.stopPropagation()} className="anim-slide-up max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[20px] bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="relative">
          {p.imageUrls[photo] ? (
            // eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand
            <img src={p.imageUrls[photo]} alt={p.name} className="aspect-square w-full object-cover" />
          ) : (
            <span className="grid aspect-square w-full place-items-center bg-stone-100 text-[64px]">🛍️</span>
          )}
          <button type="button" onClick={onClose} aria-label={t("Fermer")} className="keep-round absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[18px] shadow">
            ✕
          </button>
        </div>
        {p.imageUrls.length > 1 && (
          <div className="flex gap-2 px-4 pt-3">
            {p.imageUrls.map((u, i) => (
              <button key={u} type="button" onClick={() => setPhoto(i)} aria-label={t("Photo {n}", { n: i + 1 })} className={`h-12 w-12 overflow-hidden rounded-[8px] ${i === photo ? "ring-2 ring-emerald-600" : "opacity-70"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand */}
                <img src={thumbOf(u)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        <div className="space-y-3 px-4 pt-3">
          <div>
            <h3 className="text-[20px] font-bold">{p.name}</h3>
            <p className="text-[18px] font-bold text-emerald-700">{fcfa(p.price)}</p>
            <p className="text-[13px] text-stone-500">{p.stock <= 0 ? t("Épuisé") : p.stock <= 3 ? t("Plus que {n} en stock", { n: p.stock }) : t("En stock")}</p>
          </div>
          {p.description && <p className="whitespace-pre-line text-[14px] text-stone-700">{p.description}</p>}
          {p.options.map((o) => (
            <div key={o.name}>
              <p className="mb-1.5 text-[13px] font-semibold">{o.name}</p>
              <div className="flex flex-wrap gap-2">
                {o.values.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={choice[o.name] === v}
                    onClick={() => setChoice((c) => ({ ...c, [o.name]: v }))}
                    className={`rounded-full px-3 py-1.5 text-[14px] ${choice[o.name] === v ? "bg-ink text-white" : "bg-stone-100 text-stone-700"}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {action?.(p, choice)}
        </div>
      </div>
    </div>
  );
}
