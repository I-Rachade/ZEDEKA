"use client";

import { useEffect, useState } from "react";
import { askConfirm } from "@/components/AlertDialog";
import { Icon } from "@/components/panel/icons";
import { card, primary, secondary, Skeleton, TopBar } from "@/app/app/ui";
import { driverFetch, type FavoriteLink } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";

// Livreur favori : invitations des restaurants et boutiques, et ceux dont le livreur est le favori. Leurs courses
// lui sont proposées en premier ; il reste libre de refuser une course et de faire celles des autres.
export default function DriverFavoritesPage() {
  const t = useT();
  const [list, setList] = useState<FavoriteLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    driverFetch<FavoriteLink[]>("/favorites").then(setList, (e) => setError((e as Error).message));
  }, []);

  const answer = async (f: FavoriteLink, a: "accept" | "decline" | "leave") => {
    if (a === "leave" && !(await askConfirm(t("Ne plus être le livreur favori de {name} ?", { name: f.name }), t("Confirmer"), { destructive: true }))) return;
    setBusy(true);
    setError(null);
    try {
      setList(await driverFetch<FavoriteLink[]>(`/favorites/${f.id}/${a}`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const invites = list?.filter((f) => f.status === "INVITED") ?? [];
  const active = list?.filter((f) => f.status === "ACTIVE") ?? [];
  const row = (f: FavoriteLink) => (
    <div className="flex items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700">
        <Icon name={f.kind === "RESTAURANT" ? "menu" : "store"} className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{f.name}</span>
        <span className="block text-[13px] text-stone-600">
          {f.kind === "RESTAURANT" ? t("Restaurant") : t("Boutique")} · {f.address}
        </span>
      </span>
    </div>
  );

  return (
    <div>
      <TopBar title="Livreur favori" back="/livreur/profil" />
      <div className="space-y-4 px-4 py-4">
        <p className="text-[14px] text-stone-600">
          {t("Les courses de vos restaurants et boutiques vous sont proposées en premier. Vous restez libre de refuser une course : elle part alors aux autres livreurs.")}
        </p>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!list ? (
          <Skeleton rows={2} />
        ) : (
          <>
            {invites.map((f) => (
              <section key={f.id} className={`${card} space-y-3 p-4`}>
                <p className="text-[13px] font-semibold text-emerald-700">{t("Invitation")}</p>
                {row(f)}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={busy} onClick={() => answer(f, "decline")} className={secondary}>
                    {t("Refuser")}
                  </button>
                  <button type="button" disabled={busy} onClick={() => answer(f, "accept")} className={primary}>
                    {t("Accepter")}
                  </button>
                </div>
              </section>
            ))}
            {active.length > 0 && <h2 className="px-1 pt-2 font-semibold">{t("Je suis leur livreur favori")}</h2>}
            {active.map((f) => (
              <section key={f.id} className={`${card} space-y-3 p-4`}>
                {row(f)}
                <div className="flex gap-2">
                  <a href={`tel:${f.phone}`} className={`${secondary} flex-1`}>
                    <Icon name="phone" className="h-5 w-5" /> {t("Appeler")}
                  </a>
                  <button type="button" disabled={busy} onClick={() => answer(f, "leave")} className={`${secondary} flex-1`}>
                    {t("Me retirer")}
                  </button>
                </div>
              </section>
            ))}
            {!invites.length && !active.length && <p className="rounded-xl border border-dashed border-stone-300 p-4 text-center text-sm text-stone-600">{t("Aucun restaurant ni boutique pour l'instant. Ils vous invitent avec votre numéro.")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
