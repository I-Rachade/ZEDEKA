"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { card, primary, Skeleton } from "@/app/app/ui";
import { Icon, type IconName } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";
import { merchantFetch, type Dashboard, type MerchantParcel } from "@/lib/merchant";
import { useMerchant } from "./MerchantShell";
import { Hero, ParcelRow } from "./ui";

// Accueil de la boutique : argent à recevoir, colis du jour et en cours, bouton « Venez ramasser ».
export default function MerchantHome() {
  const t = useT();
  const { me } = useMerchant();
  const [data, setData] = useState<Dashboard | null>(null);
  const [open, setOpen] = useState<MerchantParcel[] | null>(null);
  const [pickup, setPickup] = useState<{ busy: boolean; note: string | null; error: string | null }>({ busy: false, note: null, error: null });

  const load = useCallback(async () => {
    if (!me?.merchant) return;
    const [d, list] = await Promise.all([merchantFetch<Dashboard>("/dashboard"), merchantFetch<MerchantParcel[]>("/parcels?filter=open")]);
    setData(d);
    setOpen(list);
  }, [me?.merchant]);
  useEffect(() => {
    load().catch(() => {});
  }, [load]);
  useLiveRefresh(() => void load().catch(() => {}), { every: 20_000 });

  async function requestPickup() {
    setPickup({ busy: true, note: null, error: null });
    try {
      const r = await merchantFetch<{ waiting: number }>("/pickup-request", { method: "POST", body: {} });
      setPickup({ busy: false, note: t("C'est noté : un livreur vient chercher vos {n} colis.", { n: r.waiting }), error: null });
    } catch (e) {
      setPickup({ busy: false, note: null, error: (e as Error).message });
    }
  }

  const m = me?.merchant;
  if (!m) return null;
  return (
    <div className="space-y-5 px-4 pb-6 pt-[calc(1rem+env(safe-area-inset-top))]">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-medium uppercase tracking-wide text-stone-500">{t("Espace marchand")}</p>
          <h1 className="text-[28px] font-bold leading-tight">{m.shopName}</h1>
        </div>
        <Link href="/marchand/boutique" aria-label={t("Ma boutique")} className="grid h-11 w-11 place-items-center rounded-full bg-white text-emerald-700 shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
          <Icon name="store" className="h-5 w-5" />
        </Link>
      </header>

      {!m.active && <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">{t("Votre boutique est suspendue : contactez Zedeka pour envoyer de nouveaux colis.")}</p>}

      <Hero>
        <p className="text-[13px] font-medium text-white/80">{t("À recevoir de Zedeka")}</p>
        <p className="mt-1 text-[34px] font-bold tracking-tight">{data ? fcfa(data.balance) : "…"}</p>
        <p className="text-[13px] text-white/80">
          {data ? t("{n} colis livré(s) pas encore reversé(s)", { n: data.balanceCount }) : " "}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link href="/marchand/envoyer" className="flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-3 text-[15px] font-semibold text-emerald-800 shadow-[inset_0_-2px_0_rgb(0_0_0/0.06)] active:scale-[0.98]">
            <Icon name="plus" className="h-5 w-5" /> {t("Nouvel envoi")}
          </Link>
          <Link href="/marchand/argent" className="flex items-center justify-center gap-2 rounded-2xl bg-white/15 px-3 py-3 text-[15px] font-semibold text-white ring-1 ring-white/30 backdrop-blur active:scale-[0.98]">
            <Icon name="wallet" className="h-5 w-5" /> {t("Mon argent")}
          </Link>
        </div>
      </Hero>

      <div className="grid grid-cols-3 gap-3">
        <Stat icon="box" label="Aujourd'hui" value={data?.today} />
        <Stat icon="rider" label="En cours" value={data?.open} />
        <Stat icon="check" label="Livrés ce mois" value={data?.month.delivered} />
      </div>

      {data && data.waitingPickup > 0 && (
        <section className={`${card} card-line space-y-3 p-4`}>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-sun-soft text-ink">
              <Icon name="bag" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t("{n} colis à ramasser", { n: data.waitingPickup })}</p>
              <p className="truncate text-[13px] text-stone-500">{m.pickupAddress}</p>
            </div>
          </div>
          {m.pickupDays.length > 0 && m.pickupTime && (
            <p className="text-[13px] text-stone-600">{t("Ramassage habituel à {time}. Pressé ? Prévenez l'équipe.", { time: m.pickupTime })}</p>
          )}
          <button type="button" onClick={requestPickup} disabled={pickup.busy || !m.active} className={primary}>
            <Icon name="rider" className="h-5 w-5" />
            {pickup.busy ? t("Envoi…") : t("Venez ramasser maintenant")}
          </button>
          {pickup.note && (
            <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">
              {pickup.note}
            </p>
          )}
          {pickup.error && (
            <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {pickup.error}
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[20px] font-bold">{t("Colis en cours")}</h2>
          <Link href="/marchand/colis" className="text-[15px] text-emerald-700">
            {t("Tout voir")}
          </Link>
        </div>
        {!open ? (
          <Skeleton rows={2} />
        ) : open.length === 0 ? (
          <div className={`${card} card-line p-6 text-center`}>
            <p className="font-semibold">{t("Aucun colis en cours")}</p>
            <p className="mt-1 text-sm text-stone-600">{t("Envoyez un colis, ou toute une liste de commandes d'un coup.")}</p>
          </div>
        ) : (
          open.slice(0, 8).map((p) => <ParcelRow key={p.id} p={p} />)
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: number | undefined }) {
  const t = useT();
  return (
    <div className={`${card} card-line p-3`}>
      <Icon name={icon} className="h-5 w-5 text-emerald-600" />
      <p className="mt-2 text-[22px] font-bold leading-none">{value ?? "–"}</p>
      <p className="mt-1 text-[12px] text-stone-500">{t(label)}</p>
    </div>
  );
}
