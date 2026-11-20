"use client";

import { DialogBox } from "@/components/DialogBox";
import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { fcfa, soldOut, type MenuItem } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { fromPrice, unitPrice } from "./useRestaurantCart";

// Fiche d'un plat : photos, taille à choisir (obligatoire si le plat en a), choix sans prix (sauce, cuisson…),
// suppléments facultatifs, quantité (limitée au stock s'il y en a un) et total recalculé à chaque choix.
export default function ItemDialog({
  item,
  open,
  onAdd,
  onClose,
}: {
  item: MenuItem;
  open: boolean;
  onAdd: (variantId: string | undefined, addonIds: string[], quantity: number, choices: string[]) => void;
  onClose: () => void;
}) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants.length === 1 ? item.variants[0].id : undefined);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const groups = item.options ?? [];
  const [choices, setChoices] = useState<(string | undefined)[]>(groups.map((g) => (g.values.length === 1 ? g.values[0] : undefined)));
  const [quantity, setQuantity] = useState(1);
  const t = useT();
  const needsVariant = item.variants.length > 0 && !variantId;
  const missingChoice = groups.find((_, i) => !choices[i]);
  const gone = soldOut(item);
  const maxQuantity = item.stock != null ? Math.min(20, item.stock) : 20;
  const photos = [item.imageUrl, ...(item.imageUrls ?? [])].filter((u): u is string => !!u);
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <DialogBox
        aria-label={item.name}
        onClick={(e) => e.stopPropagation()}
        className="anim-slide-up flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[14px] bg-stone-50 sm:rounded-[12px]"
      >
        <span aria-hidden="true" className="mx-auto mb-2 mt-2 block h-[5px] w-9 shrink-0 rounded-full bg-stone-300 sm:hidden" />
        <div className="relative grid flex-1 overflow-y-auto sm:grid-cols-[2fr_3fr]">
          <button onClick={onClose} aria-label={t("Fermer")} className="glass absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full text-stone-600">
            <Icon name="close" className="h-4 w-4" />
          </button>
          <div className="space-y-2 bg-surface p-4 pb-5 sm:border-r sm:border-stone-100">
            {photos.length > 1 ? (
              // Plusieurs photos : on les fait défiler du doigt, une à la fois.
              <div className="-mx-4 -mt-4 mb-3 flex aspect-[16/10] w-[calc(100%+2rem)] max-w-none snap-x snap-mandatory overflow-x-auto sm:m-0 sm:w-full sm:rounded-[12px]">
                {photos.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element -- photos fournies par les restaurants
                  <img key={src} src={src} alt={t("Photo {n} sur {total} : {name}", { n: i + 1, total: photos.length, name: item.name })} className="h-full w-full shrink-0 snap-center object-cover" />
                ))}
              </div>
            ) : photos.length === 1 ? (
              // eslint-disable-next-line @next/next/no-img-element -- photos fournies par les restaurants
              <img src={photos[0]} alt={t("Photo : {name}", { name: item.name })} className="-mx-4 -mt-4 mb-3 aspect-[16/10] w-[calc(100%+2rem)] max-w-none object-cover sm:m-0 sm:w-full sm:rounded-[12px]" />
            ) : (
              <div className="-mx-4 -mt-4 mb-3 grid aspect-[16/10] w-[calc(100%+2rem)] place-items-center bg-stone-100 text-stone-300 sm:m-0 sm:w-full sm:rounded-[12px]">
                <Icon name="menu" className="h-12 w-12" />
              </div>
            )}
            <h2 className="pr-10 text-[28px] font-bold leading-tight">{item.name}</h2>
            {item.description && <p className="text-[15px] text-stone-500">{item.description}</p>}
            <p className="text-[17px] text-stone-600">{item.variants.length ? t("dès {price}", { price: fcfa(base) }) : fcfa(base)}</p>
            {photos.length > 1 && <p className="text-[13px] text-stone-500">{t("{n} photos : faites glisser pour les voir", { n: photos.length })}</p>}
            {gone ? (
              <p className="text-[15px] font-semibold text-stone-600">{t("Épuisé pour le moment")}</p>
            ) : item.stock != null && item.stock <= 5 ? (
              <p className="text-[15px] font-medium text-amber-700">{t("Plus que {n} disponible(s)", { n: item.stock })}</p>
            ) : null}
          </div>

          <div className="space-y-6 p-4 sm:pr-14">
            {item.variants.length > 0 && (
              <fieldset>
                <legend className="mb-2 flex w-full items-center justify-between px-4 text-[13px] uppercase tracking-wide text-stone-500">
                  {t("Taille ou formule")}
                  <span className={`normal-case tracking-normal ${needsVariant ? "font-medium text-amber-700" : ""}`}>{t("Obligatoire")}</span>
                </legend>
                <div className="ios-list overflow-hidden rounded-[10px] bg-surface">
                {item.variants.map((v) => (
                  <label key={v.id} className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-3 text-[17px] active:bg-stone-100">
                    <input type="radio" name="variant" className="sr-only" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                    <span className="flex-1">{v.name}</span>
                    <span className="text-[15px] text-stone-500">{v.price > base ? `+ ${fcfa(v.price - base)}` : fcfa(v.price)}</span>
                    {/* Coche iOS à droite pour le choix unique. */}
                    <span className={`w-5 text-emerald-600 ${variantId === v.id ? "" : "invisible"}`}>
                      <Icon name="check" className="h-5 w-5" />
                    </span>
                  </label>
                ))}
                </div>
              </fieldset>
            )}
            {groups.map((g, gi) => (
              <fieldset key={g.name}>
                <legend className="mb-2 flex w-full items-center justify-between px-4 text-[13px] uppercase tracking-wide text-stone-500">
                  {g.name}
                  <span className={`normal-case tracking-normal ${choices[gi] ? "" : "font-medium text-amber-700"}`}>{t("Obligatoire")}</span>
                </legend>
                <div className="ios-list overflow-hidden rounded-[10px] bg-surface">
                  {g.values.map((v) => (
                    <label key={v} className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-3 text-[17px] active:bg-stone-100">
                      <input type="radio" name={`choice-${gi}`} className="sr-only" checked={choices[gi] === v} onChange={() => setChoices((cs) => cs.map((c, j) => (j === gi ? v : c)))} />
                      <span className="flex-1">{v}</span>
                      <span className={`w-5 text-emerald-600 ${choices[gi] === v ? "" : "invisible"}`}>
                        <Icon name="check" className="h-5 w-5" />
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            {item.addons.length > 0 && (
              <fieldset>
                <legend className="mb-2 flex w-full items-center justify-between px-4 text-[13px] uppercase tracking-wide text-stone-500">
                  {t("Suppléments")}
                  <span className="normal-case tracking-normal">{t("Facultatif")}</span>
                </legend>
                <div className="ios-list overflow-hidden rounded-[10px] bg-surface">
                {item.addons.map((a) => (
                  <label key={a.id} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-[17px] active:bg-stone-100">
                    <span className="flex-1">
                      {a.name}
                      <span className="block text-[13px] text-stone-500">{a.price ? `+ ${fcfa(a.price)}` : t("gratuit")}</span>
                    </span>
                    {/* Interrupteur iOS pour les suppléments. */}
                    <input
                      type="checkbox"
                      role="switch"
                      className="peer sr-only"
                      checked={addonIds.includes(a.id)}
                      onChange={(e) => setAddonIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                    />
                    <span aria-hidden="true" className="relative h-[31px] w-[51px] shrink-0 rounded-full bg-stone-200 transition-colors peer-checked:bg-emerald-500 after:absolute after:left-0.5 after:top-0.5 after:h-[27px] after:w-[27px] after:rounded-full after:bg-surface after:shadow-[0_3px_8px_rgb(0_0_0/0.15)] after:transition-transform peer-checked:after:translate-x-5" />
                  </label>
                ))}
                </div>
              </fieldset>
            )}
            {item.variants.length === 0 && item.addons.length === 0 && groups.length === 0 && <p className="text-sm text-stone-500">{t("Pas d'option pour ce plat.")}</p>}
          </div>
        </div>

        <div className="glass hairline-t flex items-center gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-1 rounded-full bg-stone-200/70 p-1">
            <button onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label={t("Une de moins")} className="grid h-9 w-9 place-items-center rounded-full bg-surface text-lg shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
              −
            </button>
            <span aria-label={t("Quantité")} className="w-6 text-center font-semibold">
              {quantity}
            </span>
            <button onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))} aria-label={t("Une de plus")} className="grid h-9 w-9 place-items-center rounded-full bg-surface text-lg shadow-[0_1px_2px_rgb(0_0_0/0.08)]">
              +
            </button>
          </div>
          <button
            disabled={!open || gone || needsVariant || !!missingChoice}
            onClick={() => onAdd(variantId, addonIds, quantity, choices as string[])}
            className="flex flex-1 items-center justify-between gap-2 rounded-full bg-emerald-600 px-5 py-3 text-[17px] font-semibold text-white transition active:scale-[0.98] disabled:bg-stone-300"
          >
            <span>
              {!open
                ? t("Restaurant fermé")
                : gone
                  ? t("Épuisé")
                  : needsVariant
                    ? t("Choisissez une taille")
                    : missingChoice
                      ? t("Choisissez : {name}", { name: missingChoice.name })
                      : t("Ajouter au panier")}
            </span>
            <span>{fcfa(total)}</span>
          </button>
        </div>
      </DialogBox>
    </div>
  );
}
