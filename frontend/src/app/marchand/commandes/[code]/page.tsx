"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { card, primary, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { useI18n, useT } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import { merchantFetch, SALE_STATUS, type ShopSale } from "@/lib/merchant";
import { thumbOf } from "@/lib/media";

// Une commande reçue : articles à préparer, ce que la boutique touche, et les boutons « Accepter », « Le paquet
// est prêt » (un livreur Zedeka vient le chercher) ou « Refuser ».
export default function ShopOrderPage() {
  const { code } = useParams<{ code: string }>();
  const t = useT();
  const { locale } = useI18n();
  const [o, setO] = useState<ShopSale | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      setO(await merchantFetch<ShopSale>(`/shop-orders/${code}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [code]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(() => void load(), { every: 15_000 });

  async function act(action: "accept" | "ready" | "refuse") {
    setBusy(true);
    setError(null);
    try {
      setO(await merchantFetch<ShopSale>(`/shop-orders/${code}/${action}`, { method: "POST", body: action === "refuse" && reason.trim() ? { reason: reason.trim() } : {} }));
      setRefusing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });

  return (
    <div>
      <TopBar title={`${t("Commande")} ${code}`} back="/marchand/commandes" />
      <div className="space-y-4 px-4 pb-10 pt-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!o ? (
          <Skeleton rows={4} />
        ) : (
          <>
            <section className={`${card} card-line space-y-2 p-4`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[17px] font-bold">{t(SALE_STATUS[o.status][0])}</p>
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${SALE_STATUS[o.status][1]}`}>{time(o.createdAt)}</span>
              </div>
              {o.status === "PENDING" && o.acceptBefore && <p className="text-[14px] text-amber-800">{t("Acceptez avant {time}, sinon la commande sera annulée.", { time: time(o.acceptBefore) })}</p>}
              {(o.status === "CONFIRMED" || o.status === "PREPARING") && <p className="text-[14px] text-stone-600">{t("Préparez le paquet, puis appuyez sur « Le paquet est prêt » : un livreur Zedeka vient le chercher.")}</p>}
              {o.status === "READY" && <p className="text-[14px] text-stone-600">{o.driver ? t("{name} vient chercher le paquet.", { name: o.driver.name }) : t("Un livreur Zedeka va venir chercher le paquet.")}</p>}
              {o.status === "CANCELLED" && o.cancellationReason && <p className="text-[14px] text-red-700">{o.cancellationReason}</p>}
            </section>

            <section className={`${card} card-line divide-y divide-stone-200/70`}>
              {o.storeItems.map((i, n) => (
                <div key={n} className="flex items-center gap-3 p-3">
                  {i.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- photo envoyée par le marchand
                    <img src={thumbOf(i.imageUrl)} alt="" className="h-14 w-14 shrink-0 rounded-[10px] object-cover" />
                  ) : (
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-[24px]">🛍️</span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {i.quantity} × {i.name}
                    </span>
                    {i.choice && <span className="block text-[14px] font-medium text-ink">{i.choice}</span>}
                    <span className="block text-[13px] text-stone-500">{fcfa(i.unitPrice * i.quantity)}</span>
                  </span>
                </div>
              ))}
              {o.note && <p className="p-3 text-[14px] text-stone-700">{t("Note du client : {note}", { note: o.note })}</p>}
            </section>

            <section className={`${card} card-line space-y-1.5 p-4 text-[15px]`}>
              <p className="flex justify-between">
                <span>{t("Articles")}</span>
                <span>{fcfa(o.subtotal)}</span>
              </p>
              <p className="flex justify-between text-stone-600">
                <span>{t("Part Zedeka")}</span>
                <span>− {fcfa(o.commission)}</span>
              </p>
              <p className="flex justify-between border-t border-stone-200 pt-1.5 text-[17px] font-bold text-emerald-700">
                <span>{t("Pour vous")}</span>
                <span>{fcfa(o.net)}</span>
              </p>
              <p className="text-[13px] text-stone-500">
                {o.paymentMethod === "CASH" ? t("Le client paie le livreur à la livraison.") : t("Payé en mobile money.")} {t("Versé sur « Argent » une fois livré.")}
              </p>
            </section>

            <section className={`${card} card-line space-y-1 p-4 text-[14px]`}>
              <p className="font-semibold">{o.recipientName}</p>
              {o.recipientPhone && (
                <a href={`tel:${o.recipientPhone}`} className="block text-emerald-700">
                  {o.recipientPhone}
                </a>
              )}
              <p className="text-stone-600">{o.address}</p>
            </section>

            {o.status === "PENDING" && !refusing && (
              <div className="space-y-2">
                <button type="button" disabled={busy} onClick={() => act("accept")} className={primary}>
                  {t("Accepter la commande")}
                </button>
                <button type="button" disabled={busy} onClick={() => setRefusing(true)} className="w-full py-3 text-[15px] font-semibold text-red-700">
                  {t("Refuser")}
                </button>
              </div>
            )}
            {(o.status === "CONFIRMED" || o.status === "PREPARING") && !refusing && (
              <div className="space-y-2">
                <button type="button" disabled={busy} onClick={() => act("ready")} className={primary}>
                  {t("Le paquet est prêt")}
                </button>
                <button type="button" disabled={busy} onClick={() => setRefusing(true)} className="w-full py-3 text-[15px] font-semibold text-red-700">
                  {t("Je ne peux pas la préparer")}
                </button>
              </div>
            )}
            {refusing && (
              <section className={`${card} card-line space-y-3 p-4`}>
                <p className="font-semibold">{t("Refuser la commande ?")}</p>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={200}
                  placeholder={t("Motif pour le client (ex. rupture de stock)")}
                  className="w-full rounded-xl bg-stone-100 px-4 py-3 outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setRefusing(false)} className="rounded-xl bg-stone-100 py-3 font-semibold">
                    {t("Annuler")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => act("refuse")} className="rounded-xl bg-red-600 py-3 font-semibold text-white">
                    {t("Refuser")}
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
