"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import StoreView, { type StoreViewProduct } from "@/components/StoreView";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { addToShopCart, clearShopCart, fetchShop, shopCartCount, shopCartTotal, useShopCart, type ShopPage } from "@/lib/shop";
import { Empty, Skeleton, TopBar } from "../../ui";

// Page d'une boutique côté client : bannières, rayons, produits ; la fiche d'un produit ajoute au panier.
export default function ShopPageView() {
  const { slug } = useParams<{ slug: string }>();
  const t = useT();
  const [shop, setShop] = useState<ShopPage | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const cart = useShopCart();
  const mine = cart && cart.slug === slug ? cart : null;

  useEffect(() => {
    fetchShop(slug)
      .then(setShop)
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  return (
    <div className="pb-32">
      <TopBar title={shop?.name ?? "Boutique"} back="/app/boutiques" />
      {error ? (
        <div className="p-4">
          <Empty icon="store" title="Boutique indisponible">
            {error}
          </Empty>
        </div>
      ) : shop === undefined ? (
        <div className="p-4">
          <Skeleton />
        </div>
      ) : shop === null ? (
        <div className="p-4">
          <Empty icon="store" title="Cette boutique n'est pas ouverte en ce moment" />
        </div>
      ) : (
        <StoreView store={shop} action={(p, choice) => <AddButton shop={shop} product={p} choice={choice} />} />
      )}

      {mine && mine.lines.length > 0 && (
        <Link
          href={`/app/boutiques/${slug}/panier`}
          className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-2xl bg-emerald-700 px-4 py-3.5 text-white shadow-lg"
        >
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[14px] font-bold">{shopCartCount(mine)}</span>
          <span className="font-semibold">{t("Voir le panier")}</span>
          <span className="font-bold">{fcfa(shopCartTotal(mine))}</span>
        </Link>
      )}
    </div>
  );
}

// Bouton de la fiche produit : toutes les options choisies, dans la limite du stock. Un panier d'une autre
// boutique est remplacé, et le bouton le dit avant.
function AddButton({ shop, product: p, choice }: { shop: ShopPage; product: StoreViewProduct; choice: Record<string, string> }) {
  const t = useT();
  const cart = useShopCart();
  const [added, setAdded] = useState(false);
  const missing = p.options.find((o) => !choice[o.name]);
  const other = cart && cart.slug !== shop.slug && cart.lines.length > 0 ? cart : null;
  const inCart = cart?.slug === shop.slug ? cart.lines.filter((l) => l.productId === p.id).reduce((s, l) => s + l.quantity, 0) : 0;
  const full = p.stock > 0 && inCart >= p.stock;

  useEffect(() => setAdded(false), [choice]);

  if (p.stock <= 0) {
    return <p className="rounded-xl bg-stone-100 p-3 text-center text-[15px] font-semibold text-stone-500">{t("Épuisé")}</p>;
  }
  return (
    <div className="space-y-2 pt-1">
      {other && <p className="text-[13px] text-amber-800">{t("Votre panier contient des articles de {name} : il sera vidé.", { name: other.name })}</p>}
      <button
        type="button"
        disabled={!!missing || full}
        onClick={() => {
          if (other) clearShopCart();
          if (addToShopCart(shop, p, choice)) setAdded(true);
        }}
        className="w-full rounded-xl bg-emerald-600 py-3.5 text-[16px] font-semibold text-white active:scale-[0.98] disabled:bg-stone-300"
      >
        {missing ? t("Choisissez : {option}", { option: missing.name }) : full ? t("Tout le stock est dans votre panier") : added ? `✓ ${t("Ajouté au panier")}` : `${t("Ajouter au panier")} · ${fcfa(p.price)}`}
      </button>
      {added && (
        <Link href={`/app/boutiques/${shop.slug}/panier`} className="block text-center text-[15px] font-semibold text-emerald-700">
          {t("Voir le panier")}
        </Link>
      )}
    </div>
  );
}
