"use client";

import { useEffect, useState } from "react";
import { Skeleton, TopBar } from "@/app/app/ui";
import StoreView from "@/components/StoreView";
import { useT } from "@/lib/i18n/client";
import { merchantFetch, type StoreCategory, type StorePreview, type StoreState } from "@/lib/merchant";

// Aperçu de la boutique telle que les clients la verront : bannières actives et produits publiés (acceptés par
// l'équipe et visibles). Le bouton d'achat arrive avec l'ouverture de la vente.
export default function StorePreviewPage() {
  const t = useT();
  const [data, setData] = useState<StorePreview | null>(null);
  const [categories, setCategories] = useState<StoreCategory[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([merchantFetch<StorePreview>("/store/preview"), merchantFetch<StoreState>("/store")])
      .then(([p, s]) => {
        setData(p);
        if ("categories" in s) setCategories(s.categories);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const category = categories.find((c) => c.key === data?.store.category) ?? null;
  return (
    <div>
      <TopBar title="Aperçu client" back="/marchand/produits" />
      <p className="mx-4 mt-3 rounded-xl bg-sun-soft p-3 text-[13px] text-ink-deep">{t("Ce que verront vos clients : seuls les produits vérifiés et visibles apparaissent.")}</p>
      {error && <p className="m-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data ? (
        !error && (
          <div className="p-4">
            <Skeleton rows={3} />
          </div>
        )
      ) : (
        <StoreView
          store={{
            name: data.name,
            area: data.area,
            category,
            description: data.store.description,
            logoUrl: data.store.logoUrl,
            verified: data.store.status === "ONLINE",
            banners: data.banners,
            products: data.products,
          }}
          action={() => (
            <button type="button" disabled className="mt-1 w-full rounded-2xl bg-emerald-600 px-4 py-4 text-[17px] font-semibold text-white opacity-40">
              {t("Ajouter au panier")}
            </button>
          )}
        />
      )}
    </div>
  );
}
