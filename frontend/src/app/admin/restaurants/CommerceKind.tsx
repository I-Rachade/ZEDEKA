"use client";

import { useState } from "react";
import { SHOP_CATEGORIES, type AdminRestaurant, type CommerceKind } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { input } from "../ui";

// Type de commerce dans les formulaires de l'admin : restaurant ou boutique (avec sa catégorie), et la
// vérification des nouveaux articles par l'équipe. Les valeurs partent avec le formulaire (kind, shopCategory,
// reviewNewItems) ; commerceBody les lit.
export function CommerceKindFields({ initial }: { initial?: Pick<AdminRestaurant, "kind" | "shopCategory" | "reviewNewItems"> }) {
  const [kind, setKind] = useState<CommerceKind>(initial?.kind ?? "RESTAURANT");
  const t = useT();
  return (
    <fieldset className="grid gap-2 rounded-lg border border-stone-200 p-3 text-sm sm:col-span-2 sm:grid-cols-2">
      <legend className="px-1 font-medium">{t("Type de commerce")}</legend>
      <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as CommerceKind)} className={input} aria-label={t("Type de commerce")}>
        <option value="RESTAURANT">{t("Restaurant")}</option>
        <option value="SHOP">{t("Boutique")}</option>
      </select>
      {kind === "SHOP" && (
        <select name="shopCategory" required defaultValue={initial?.shopCategory ?? ""} className={input} aria-label={t("Catégorie de la boutique")}>
          <option value="" disabled>
            {t("Catégorie de la boutique")}
          </option>
          {SHOP_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.emoji} {t(c.label)}
            </option>
          ))}
        </select>
      )}
      <label className="flex items-start gap-2 sm:col-span-2">
        <input name="reviewNewItems" type="checkbox" defaultChecked={initial?.reviewNewItems ?? false} className="mt-1" />
        <span>
          {t("Vérifier les nouveaux articles")}
          <span className="block text-xs text-stone-500">{t("Un article ajouté par le commerce reste masqué jusqu'à ce que l'équipe le rende disponible.")}</span>
        </span>
      </label>
    </fieldset>
  );
}

export function commerceBody(f: FormData) {
  const kind = (f.get("kind") as CommerceKind | null) ?? "RESTAURANT";
  return {
    kind,
    shopCategory: kind === "SHOP" ? String(f.get("shopCategory") || "") || null : null,
    reviewNewItems: f.get("reviewNewItems") === "on",
  };
}

export function kindLabel(r: Pick<AdminRestaurant, "kind" | "shopCategory">, t: (s: string) => string) {
  if (r.kind !== "SHOP") return t("Restaurant");
  const c = SHOP_CATEGORIES.find((x) => x.key === r.shopCategory);
  return c ? `${t("Boutique")} · ${c.emoji} ${t(c.label)}` : t("Boutique");
}
