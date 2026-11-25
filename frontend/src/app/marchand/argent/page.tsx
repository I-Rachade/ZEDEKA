"use client";

import { useEffect, useState } from "react";
import { card, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/client";
import { merchantFetch, type Dashboard, type MerchantParcel, type Payout } from "@/lib/merchant";
import { useMerchant } from "../MerchantShell";
import { Hero, ParcelRow, shortDate } from "../ui";

// Argent de la boutique : solde à recevoir (contre-remboursements moins la livraison), colis concernés, reversements.
export default function MoneyPage() {
  const t = useT();
  const { locale } = useI18n();
  const { me } = useMerchant();
  const [data, setData] = useState<Dashboard | null>(null);
  const [unpaid, setUnpaid] = useState<MerchantParcel[] | null>(null);
  const [payouts, setPayouts] = useState<Payout[] | null>(null);

  useEffect(() => {
    merchantFetch<Dashboard>("/dashboard").then(setData).catch(() => {});
    merchantFetch<MerchantParcel[]>("/parcels?filter=done")
      .then((list) => setUnpaid(list.filter((p) => p.status === "DELIVERED" && !p.paidOut)))
      .catch(() => setUnpaid([]));
    merchantFetch<Payout[]>("/payouts").then(setPayouts).catch(() => setPayouts([]));
  }, []);

  const m = me?.merchant;
  return (
    <div>
      <TopBar title="Mon argent" />
      <div className="space-y-5 px-4 pb-6 pt-4">
        <Hero>
          <p className="text-[13px] font-medium text-white/80">{data && data.balance < 0 ? t("Frais de livraison à régler") : t("À recevoir de Zedeka")}</p>
          <p className="mt-1 text-[34px] font-bold tracking-tight">{data ? fcfa(Math.abs(data.balance)) : "…"}</p>
          <p className="text-[13px] text-white/80">
            {m?.payoutPhone ? t("Reversé par mobile money au {phone}", { phone: m.payoutPhone }) : t("Ajoutez votre numéro mobile money dans Boutique pour être payé plus vite.")}
          </p>
        </Hero>

        {data && (
          <div className="grid grid-cols-2 gap-3">
            <div className={`${card} card-line p-4`}>
              <p className="text-[12px] uppercase tracking-wide text-stone-500">{t("Encaissé ce mois")}</p>
              <p className="mt-1 text-[20px] font-bold">{fcfa(data.month.cod)}</p>
            </div>
            <div className={`${card} card-line p-4`}>
              <p className="text-[12px] uppercase tracking-wide text-stone-500">{t("Colis ce mois")}</p>
              <p className="mt-1 text-[20px] font-bold">
                {data.month.delivered} / {data.month.sent}
              </p>
              <p className="text-[12px] text-stone-500">{t("livrés / envoyés")}</p>
            </div>
          </div>
        )}

        <p className="rounded-2xl bg-white/70 p-4 text-[13px] leading-relaxed text-stone-600 ring-1 ring-stone-200/70">
          {t("Comment ça marche : le livreur encaisse le prix des articles chez votre client. Zedeka vous le reverse, moins la livraison quand c'est votre boutique qui la paie. Les colis déjà payés en ligne ne coûtent que la livraison.")}
        </p>

        <section className="space-y-3">
          <h2 className="text-[20px] font-bold">{t("Pas encore reversés")}</h2>
          {!unpaid ? <Skeleton rows={2} /> : unpaid.length === 0 ? <p className="text-sm text-stone-500">{t("Rien en attente.")}</p> : unpaid.map((p) => <ParcelRow key={p.id} p={p} />)}
        </section>

        <section className="space-y-3">
          <h2 className="text-[20px] font-bold">{t("Reversements")}</h2>
          {!payouts ? (
            <Skeleton rows={2} />
          ) : payouts.length === 0 ? (
            <p className="text-sm text-stone-500">{t("Aucun reversement pour l'instant.")}</p>
          ) : (
            <ul className={`${card} card-line divide-y divide-stone-100 px-4`}>
              {payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-medium">{shortDate(p.createdAt, locale)}</span>
                    <span className="block text-[13px] text-stone-500">{t("{n} colis", { n: p.orderCount })}</span>
                  </span>
                  <span className={`font-bold ${p.amount < 0 ? "text-red-700" : "text-emerald-700"}`}>{fcfa(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
