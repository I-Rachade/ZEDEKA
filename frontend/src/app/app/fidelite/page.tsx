"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { customerFetch, useSession, type PlusState } from "@/lib/customer";
import { useHydrated } from "@/lib/device";
import { useI18n, useT } from "@/lib/i18n/client";
import { fcfa } from "@/lib/api";
import { card, primary, secondary, TopBar } from "../ui";

// Fidélité et Zedeka+ : points gagnés sur chaque commande livrée (échangés contre une livraison offerte à la caisse),
// et l'abonnement Zedeka+ (livraison des repas offerte ou réduite pour un prix fixe par mois, payé à l'équipe).
type Points = { earned: number; redeemed: number; points: number; rewardPoints: number; rewards: number; toNext: number; spendPerPoint: number };
type Loyalty = { points: Points; plus: PlusState; history: { code: string; createdAt: string; discount: number; plusApplied: boolean; loyaltyRedeemed: number }[] };

export default function LoyaltyPage() {
  const t = useT();
  const { locale } = useI18n();
  const hydrated = useHydrated();
  const session = useSession();
  const [data, setData] = useState<Loyalty | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    customerFetch<Loyalty>("/loyalty")
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (session) load();
  }, [session, load]);

  async function plusRequest(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    try {
      const plus = await customerFetch<PlusState>("/plus/request", { method });
      setData((d) => (d ? { ...d, plus } : d));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
  const p = data?.points;
  const plus = data?.plus;
  const progress = p && p.rewardPoints > 0 ? Math.min(100, Math.round(((p.points % p.rewardPoints) / p.rewardPoints) * 100)) : 0;

  return (
    <div>
      <TopBar title="Fidélité et Zedeka+" back="/app/profil" />
      <div className="space-y-4 px-4 py-4">
        {!hydrated ? null : !session ? (
          <section className={`${card} space-y-3 p-4`}>
            <p className="font-semibold">{t("Gagnez des points à chaque commande")}</p>
            <p className="text-sm text-stone-600">{t("Connectez-vous pour voir vos points et Zedeka+.")}</p>
            <Link href="/app/connexion?suite=/app/fidelite" className={primary}>
              {t("Se connecter")}
            </Link>
          </section>
        ) : (
          <>
            {plus?.enabled && (
              <section className="deep-green space-y-3 rounded-[12px] p-4 text-white">
                <p className="font-display text-2xl font-extrabold">Zedeka+</p>
                <p className="text-[15px]">
                  {plus.deliveryDiscount >= 100
                    ? t("Livraison des repas offerte dès {min} de panier, pour {fee} par mois.", { min: fcfa(plus.minSubtotal), fee: fcfa(plus.monthlyFee) })
                    : t("Livraison des repas à -{pct} % dès {min} de panier, pour {fee} par mois.", { pct: plus.deliveryDiscount, min: fcfa(plus.minSubtotal), fee: fcfa(plus.monthlyFee) })}
                </p>
                {plus.active && plus.until ? (
                  <p className="rounded-xl bg-white/15 p-3 text-sm font-semibold">{t("Vous êtes abonné jusqu'au {date}. La remise s'applique d'office à la caisse.", { date: day(plus.until) })}</p>
                ) : plus.requestedAt ? (
                  <div className="space-y-2">
                    <p className="rounded-xl bg-white/15 p-3 text-sm">{t("Demande envoyée : l'équipe Zedeka vous appelle pour le paiement (mobile money ou espèces), puis active votre abonnement.")}</p>
                    <button type="button" onClick={() => plusRequest("DELETE")} disabled={busy} className="text-sm underline">
                      {t("Annuler la demande")}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => plusRequest("POST")} disabled={busy} className={`${secondary} bg-white text-emerald-900`}>
                    {busy ? "…" : t("S'abonner à Zedeka+")}
                  </button>
                )}
              </section>
            )}

            {p && (
              <section className={`${card} space-y-3 p-4`}>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-sm text-stone-600">{t("Mes points")}</p>
                    <p className="text-3xl font-bold text-emerald-700">{p.points}</p>
                  </div>
                  {p.rewards > 0 && <p className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">{t("{n} livraison(s) offerte(s)", { n: p.rewards })}</p>}
                </div>
                {p.spendPerPoint > 0 && p.rewardPoints > 0 ? (
                  <>
                    <div className="h-2 overflow-hidden rounded-full bg-stone-100" aria-hidden="true">
                      <div className="h-full rounded-full bg-emerald-600" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-sm text-stone-600">
                      {t("1 point pour {amount} dépensés sur une commande livrée. {reward} points = une livraison offerte.", { amount: fcfa(p.spendPerPoint), reward: p.rewardPoints })}{" "}
                      {t("Encore {n} points pour la prochaine.", { n: p.toNext })}
                    </p>
                    {p.rewards > 0 && <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{t("Utilisez-la à la caisse d'une commande livrée, avec « Utiliser une livraison offerte ».")}</p>}
                  </>
                ) : (
                  <p className="text-sm text-stone-600">{t("Le programme de points est en pause.")}</p>
                )}
              </section>
            )}

            <Link href="/app/parrainage" className={`${card} flex items-center justify-between gap-3 p-4`}>
              <span className="font-semibold">{t("Parrainage : livraisons offertes")}</span>
              <span className="font-bold">›</span>
            </Link>

            {data && data.history.length > 0 && (
              <section className={`${card} p-4`}>
                <p className="mb-2 font-semibold">{t("Avantages utilisés")}</p>
                <ul className="divide-y divide-stone-100 text-sm">
                  {data.history.map((h) => (
                    <li key={h.code} className="flex justify-between gap-2 py-2">
                      <span>
                        {h.code} · {day(h.createdAt)}
                        <span className="block text-xs text-stone-500">{h.plusApplied ? "Zedeka+" : t("{n} points", { n: h.loyaltyRedeemed })}</span>
                      </span>
                      <span className="font-semibold text-emerald-700">-{fcfa(h.discount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
