"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { card, Skeleton, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { merchantFetch, REVIEW_STATUS, STORE_STATUS, type Product, type StoreState } from "@/lib/merchant";
import { thumbOf } from "@/lib/media";

// Ma boutique en ligne : état de la demande, raccourcis (présentation, bannières, aperçu) et liste des produits.
export default function ProductsPage() {
  const t = useT();
  const [state, setState] = useState<StoreState | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [filter, setFilter] = useState<"ALL" | "PENDING" | "LOW">("ALL");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await merchantFetch<StoreState>("/store");
      setState(s);
      if (s.store) setProducts(await merchantFetch<Product[]>("/products"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (state && !state.store) {
    return (
      <div>
        <TopBar title="Vendre en ligne" back="/marchand" />
        <p className="m-4 rounded-2xl bg-stone-100 p-4 text-[15px] text-stone-700">{t("La vente en ligne n'est pas encore ouverte sur Zedeka.")}</p>
      </div>
    );
  }

  const shown = (products ?? []).filter((p) => (filter === "PENDING" ? p.review !== "APPROVED" : filter === "LOW" ? p.stock <= 3 : true));
  const low = (products ?? []).filter((p) => p.stock <= 3).length;
  const store = state?.store ?? null;
  const counts = state && "counts" in state ? state.counts : null;

  return (
    <div>
      <TopBar title="Ma boutique en ligne" back="/marchand" />
      <div className="space-y-4 px-4 pb-8 pt-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!store ? (
          <Skeleton rows={3} />
        ) : (
          <>
            <StatusCard state={state!} />
            <div className="grid grid-cols-4 gap-2">
              <Shortcut href="/marchand/commandes" icon="bag" label="Commandes" />
              <Shortcut href="/marchand/vente" icon="store" label="Présentation" />
              <Shortcut href="/marchand/bannieres" icon="grid" label={`${t("Bannières")} (${counts?.banners ?? 0})`} />
              <Shortcut href="/marchand/apercu" icon="search" label="Aperçu" />
            </div>
          </>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[20px] font-bold">{t("Mes produits")}</h2>
            <Link href="/marchand/produits/nouveau" className="flex items-center gap-1 rounded-full bg-emerald-600 px-4 py-2 text-[15px] font-semibold text-white active:scale-95">
              <Icon name="plus" className="h-4 w-4" /> {t("Ajouter")}
            </Link>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {(
              [
                ["ALL", `${t("Tous")} (${products?.length ?? 0})`],
                ["PENDING", `${t("À vérifier")} (${(counts?.pending ?? 0) + (counts?.rejected ?? 0)})`],
                ["LOW", `${t("Stock bas")} (${low})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[14px] font-medium ${filter === key ? "bg-ink text-white" : "bg-stone-100 text-stone-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {!products ? (
            <Skeleton rows={3} />
          ) : products.length === 0 ? (
            <div className={`${card} card-line p-6 text-center`}>
              <p className="font-semibold">{t("Aucun produit pour l'instant")}</p>
              <p className="mt-1 text-sm text-stone-600">{t("Ajoutez vos produits avec une belle photo, un prix et le stock disponible.")}</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {shown.map((p) => (
                <li key={p.id}>
                  <ProductRow p={p} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function StatusCard({ state }: { state: StoreState }) {
  const t = useT();
  if (!("counts" in state) || !state.store) return null;
  const { store, counts, reviewedFirst } = state;
  const [label, color] = STORE_STATUS[store.status];
  const left = Math.max(0, reviewedFirst - counts.approved);
  return (
    <section className={`${card} card-line space-y-2 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[17px] font-bold">{t("Vente en ligne")}</p>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${color}`}>{t(label)}</span>
      </div>
      {store.status === "NONE" && (
        <>
          <p className="text-[14px] text-stone-600">{t("Ajoutez vos produits et vos bannières, puis demandez la mise en ligne. L'équipe Zedeka vérifie votre boutique avant qu'elle soit visible.")}</p>
          <Link href="/marchand/vente" className="inline-flex items-center gap-1 text-[15px] font-semibold text-emerald-700">
            {t("Demander la mise en ligne")} <Icon name="chevron" className="h-4 w-4" />
          </Link>
        </>
      )}
      {store.status === "PENDING" && <p className="text-[14px] text-stone-600">{t("Demande envoyée : l'équipe vérifie votre pièce et vos photos. Vous serez prévenu sur ce téléphone.")}</p>}
      {(store.status === "REJECTED" || store.status === "SUSPENDED") && (
        <p className="rounded-xl bg-red-50 p-3 text-[14px] text-red-800">
          {store.note ?? t("Contactez Zedeka.")}
          {store.status === "REJECTED" && (
            <Link href="/marchand/vente" className="mt-1 block font-semibold underline">
              {t("Compléter et renvoyer la demande")}
            </Link>
          )}
        </p>
      )}
      {store.status === "ONLINE" && (
        <p className="text-[14px] text-stone-600">
          {store.billing.mode === "SUBSCRIPTION"
            ? t("Abonnement : {fee} par mois, sans commission.", { fee: fcfa(store.billing.fee ?? 0) })
            : t("Commission Zedeka : {rate} % par vente.", { rate: store.billing.rate })}
        </p>
      )}
      {left > 0 && counts.total > 0 && (
        <p className="text-[13px] text-stone-500">{t("Vos {n} premiers produits sont vérifiés par Zedeka, ensuite ils sont publiés directement.", { n: reviewedFirst })}</p>
      )}
    </section>
  );
}

function Shortcut({ href, icon, label }: { href: string; icon: "store" | "grid" | "search" | "bag"; label: string }) {
  const t = useT();
  return (
    <Link href={href} className={`${card} card-line flex flex-col items-center gap-1 p-3 text-center text-[13px] font-semibold active:scale-[0.98]`}>
      <Icon name={icon} className="h-5 w-5 text-emerald-700" />
      {t(label)}
    </Link>
  );
}

function ProductRow({ p }: { p: Product }) {
  const t = useT();
  const [label, color] = p.visible ? REVIEW_STATUS[p.review] : ["Caché", "bg-stone-200 text-stone-600"];
  const stock = p.stock <= 0 ? ["Épuisé", "text-red-700"] : p.stock <= 3 ? ["Stock bas", "text-amber-700"] : null;
  return (
    <Link href={`/marchand/produits/${p.id}`} className={`${card} card-line flex items-center gap-3 p-3 active:scale-[0.99]`}>
      {p.imageUrls[0] ? (
        // eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand
        <img src={thumbOf(p.imageUrls[0])} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
      ) : (
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-stone-400">
          <Icon name="bag" className="h-6 w-6" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{p.name}</span>
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{t(label)}</span>
        </span>
        <span className="block text-[13px] text-stone-600">
          {fcfa(p.price)} · {t("stock {n}", { n: p.stock })}
          {stock && <span className={`ml-1 font-semibold ${stock[1]}`}>· {t(stock[0])}</span>}
        </span>
        {p.review === "REJECTED" && p.reviewNote && <span className="block truncate text-[12px] text-red-700">{p.reviewNote}</span>}
      </span>
    </Link>
  );
}
