"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { fcfa, type MenuItem } from "@/lib/api";
import { fromPrice, unitPrice } from "./useRestaurantCart";

// Fiche d'un plat : photo, taille à choisir (obligatoire si le plat en a), suppléments facultatifs,
// quantité et total recalculé à chaque choix.
export default function ItemDialog({ item, open, onAdd, onClose }: { item: MenuItem; open: boolean; onAdd: (variantId: string | undefined, addonIds: string[], quantity: number) => void; onClose: () => void }) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants.length === 1 ? item.variants[0].id : undefined);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const needsVariant = item.variants.length > 0 && !variantId;
  const base = fromPrice(item);
  const total = unitPrice(item, variantId ?? (item.variants.length ? item.variants[0].id : undefined), addonIds) * quantity;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl"
      >
        <div className="relative grid flex-1 overflow-y-auto sm:grid-cols-[2fr_3fr]">
          <button onClick={onClose} aria-label="Fermer" className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow">
            <Icon name="close" className="h-5 w-5" />
          </button>
          <div className="space-y-2 p-4 sm:border-r sm:border-stone-100">
            {item.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- photos fournies par les restaurants
              <img src={item.imageUrl} alt="" className="aspect-[4/3] w-full rounded-2xl object-cover" />
            ) : (
              <div className="grid aspect-[4/3] w-full place-items-center rounded-2xl bg-stone-100 text-stone-400">
                <Icon name="menu" className="h-12 w-12" />
              </div>
            )}
            <h2 className="pr-10 text-xl font-bold">{item.name}</h2>
            {item.description && <p className="text-sm text-stone-600">{item.description}</p>}
            <p className="font-semibold">{item.variants.length ? `dès ${fcfa(base)}` : fcfa(base)}</p>
          </div>

          <div className="space-y-5 p-4 sm:pr-14">
            {item.variants.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="flex w-full items-center justify-between font-semibold">
                  Taille ou formule
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${needsVariant ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-600"}`}>choisir 1 · obligatoire</span>
                </legend>
                {item.variants.map((v) => (
                  <label key={v.id} className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-3 ${variantId === v.id ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}>
                    <span className="flex items-center gap-2">
                      <input type="radio" name="variant" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                      {v.name}
                    </span>
                    <span className="text-sm text-stone-600">{v.price > base ? `+ ${fcfa(v.price - base)}` : fcfa(v.price)}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {item.addons.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="flex w-full items-center justify-between font-semibold">
                  Suppléments
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">facultatif</span>
                </legend>
                {item.addons.map((a) => (
                  <label key={a.id} className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-3 ${addonIds.includes(a.id) ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}>
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={addonIds.includes(a.id)}
                        onChange={(e) => setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                      />
                      {a.name}
                    </span>
                    <span className="text-sm text-stone-600">{a.price ? `+ ${fcfa(a.price)}` : "gratuit"}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {item.variants.length === 0 && item.addons.length === 0 && <p className="text-sm text-stone-500">Pas d&apos;option pour ce plat.</p>}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-stone-100 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Une de moins" className="grid h-10 w-10 place-items-center rounded-full border border-stone-300 text-lg">
              −
            </button>
            <span aria-label="Quantité" className="w-6 text-center font-semibold">
              {quantity}
            </span>
            <button onClick={() => setQuantity((q) => Math.min(20, q + 1))} aria-label="Une de plus" className="grid h-10 w-10 place-items-center rounded-full border border-stone-300 text-lg">
              +
            </button>
          </div>
          <button
            disabled={!open || needsVariant}
            onClick={() => onAdd(variantId, addonIds, quantity)}
            className="flex flex-1 items-center justify-between gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            <span>{!open ? "Restaurant fermé" : needsVariant ? "Choisissez une taille" : "Ajouter au panier"}</span>
            <span>{fcfa(total)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
