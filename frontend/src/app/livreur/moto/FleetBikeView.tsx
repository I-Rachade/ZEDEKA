"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { card, primary, secondary, TopBar } from "@/app/app/ui";
import { driverImage, type StaffMotorbike } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { useDriver } from "../DriverShell";
import MotoPicker from "../MotoPicker";

// « Ma moto » d'un livreur salarié : la plaque de la moto du parc avec laquelle il travaille aujourd'hui. La
// répartition la lui attribue, ou il fait lui-même son check-in avant de commencer (et peut en changer entre deux
// courses). Elle est rendue quand il passe hors ligne.
export default function FleetBikeView({ state, reload }: { state: StaffMotorbike; reload: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const { reload: reloadCurrent } = useDriver();
  const [picking, setPicking] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const bike = state.motorbike;

  useEffect(() => {
    if (!bike?.hasPhoto) {
      setPhoto(null);
      return;
    }
    let local: string | null = null;
    driverImage(`/motorbikes/${bike.id}/photo`).then((u) => setPhoto((local = u)));
    return () => {
      if (local) URL.revokeObjectURL(local);
    };
  }, [bike?.id, bike?.hasPhoto]);

  const since = bike?.assignedAt
    ? new Date(bike.assignedAt).toLocaleString(locale, { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })
    : null;

  return (
    <div>
      <TopBar title="Ma moto" back="/livreur/profil" />
      <div className="space-y-4 px-4 py-4">
        {bike ? (
          <section className="overflow-hidden rounded-[12px] bg-ink-deep text-white">
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt="" className="h-44 w-full object-cover" />
            )}
            <div className="space-y-1 p-4">
              <p className="text-sm text-white/70">{t("Moto du jour")}</p>
              <p className="font-mono text-3xl font-bold tracking-wider" aria-label={t("Plaque de la moto")}>
                {bike.plate}
              </p>
              {bike.label && <p className="text-white/80">{bike.label}</p>}
              <p className="pt-1 text-sm text-white/70">
                {bike.assignedBy ? t("Attribuée par {name}", { name: bike.assignedBy }) : t("Prise par vous (check-in)")}
                {since ? ` · ${since}` : ""}
              </p>
            </div>
          </section>
        ) : (
          <section className={`${card} space-y-2 p-4`}>
            <h2 className="text-lg font-semibold">{t("Pas encore de moto aujourd'hui")}</h2>
            <p className="text-sm text-stone-700">
              {state.needsMotorbike
                ? t("Avant de commencer, prenez la moto du parc avec laquelle vous travaillez, ou attendez que la répartition vous en attribue une.")
                : t("Aucune moto du parc pour le moment. La répartition vous en attribue une.")}
            </p>
          </section>
        )}

        {state.needsMotorbike || bike ? (
          state.canChange ? (
            <button onClick={() => setPicking(true)} className={bike ? secondary : primary}>
              {bike ? t("Changer de moto") : t("Faire mon check-in")}
            </button>
          ) : (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Terminez d'abord votre course en cours pour changer de moto.")}</p>
          )
        ) : null}

        <section className={`${card} flex gap-3 p-4 text-sm text-stone-700`}>
          <Icon name="rider" className="h-5 w-5 shrink-0 text-stone-500" />
          <p>{t("Le client voit la plaque de cette moto. Elle est rendue au parc quand vous passez hors ligne.")}</p>
        </section>
      </div>

      {picking && (
        <MotoPicker
          checkIn
          onClose={() => setPicking(false)}
          onDone={async () => {
            setPicking(false);
            await Promise.all([reload(), reloadCurrent()]);
          }}
        />
      )}
    </div>
  );
}
