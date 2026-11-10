"use client";

import { DialogBox } from "@/components/DialogBox";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, savePlace, usePlace, useSession, type Address, type Profile } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { useZones } from "./data";

// « Livrer à » : adresse enregistrée ou simple zone. Détermine les frais et l'ordre des restaurants.
export default function PlacePicker({ onGreen = false }: { onGreen?: boolean }) {
  const place = usePlace();
  const session = useSession();
  const zones = useZones();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);

  useEffect(() => {
    if (!open || !session) return;
    customerFetch<Profile>("/me").then((p) => setAddresses(p.addresses), () => setAddresses([]));
  }, [open, session]);

  // Haut de la liste déroulante : sous la barre de recherche de l'accueil (data-home-search).
  const [dropTop, setDropTop] = useState(120);
  const show = () => {
    const bar = document.querySelector("[data-home-search]")?.getBoundingClientRect();
    if (onGreen && bar) setDropTop(Math.max(8, bar.bottom + 8));
    setOpen(true);
  };

  const zoneName = zones.data?.find((z) => z.id === place?.zoneId)?.name;

  return (
    <>
      {onGreen ? (
        // En-tête vert de l'accueil : « 📍 Livrer à » au-dessus, « Maison · Bè Kpota ▾ » en gras.
        <button data-place-picker onClick={show} className="block w-full min-w-0 text-left text-white">
          <span className="flex items-center gap-1 text-[13px] text-white/80">
            <Icon name="pin" className="h-3.5 w-3.5 text-red-300" /> {t("Livrer à")}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-[17px] font-semibold">
            <span className="truncate">{place ? (place.addressId ? `${place.label}${zoneName ? ` · ${zoneName}` : ""}` : (zoneName ?? place.label)) : t("Choisir ma zone")}</span>
            <span className="shrink-0 rotate-90">
              <Icon name="chevron" className="h-3.5 w-3.5" />
            </span>
          </span>
        </button>
      ) : (
        <button data-place-picker onClick={show} className="flex w-full min-w-0 items-center gap-2 text-left">
          <Icon name="pin" className="h-5 w-5 shrink-0 text-emerald-600" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-stone-500">{t("Livrer à")}</span>
            <span className="block truncate font-semibold">{place ? (place.addressId ? place.label : (zoneName ?? place.label)) : t("Choisir ma zone")}</span>
          </span>
          <span className="shrink-0 rotate-90 text-stone-500">
            <Icon name="chevron" className="h-4 w-4" />
          </span>
        </button>
      )}

      {open && (
        // Accueil (onGreen) : liste déroulante juste sous la barre de recherche ; ailleurs, feuille qui monte du bas.
        // text-ink : la liste est rendue dans l'en-tête vert (texte blanc), elle doit reprendre une écriture foncée.
        <div
          className={`fixed inset-0 z-50 flex bg-black/40 text-ink ${onGreen ? "items-start" : "items-end"}`}
          style={onGreen ? { paddingTop: dropTop } : undefined}
          onClick={() => setOpen(false)}
        >
          <DialogBox
            onClose={() => setOpen(false)}
            aria-label={t("Où livrer ?")}
            onClick={(e) => e.stopPropagation()}
            className={
              onGreen
                ? "anim-slide-down mx-auto max-h-[60vh] w-[calc(100%-2rem)] max-w-[calc(28rem-2rem)] overflow-y-auto rounded-2xl bg-surface p-4 shadow-[0_16px_40px_rgb(0_0_0/0.25)]"
                : "mx-auto max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            }
          >
            {!onGreen && <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-stone-300" />}
            <h2 className="mb-3 text-lg font-semibold">{t("Où livrer ?")}</h2>
            {addresses.length > 0 && (
              <ul className="mb-4 space-y-2">
                {addresses.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => {
                        savePlace({ addressId: a.id, zoneId: a.zone.id, label: a.label });
                        setOpen(false);
                      }}
                      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left ${place?.addressId === a.id ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}
                    >
                      <Icon name="pin" className="mt-1 h-5 w-5 text-stone-500" />
                      <span className="min-w-0">
                        <span className="block font-medium">{a.label}</span>
                        <span className="block truncate text-sm text-stone-600">
                          {a.quarter}, {a.landmark}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-2 text-sm font-medium text-stone-600">{addresses.length ? t("Ou seulement une zone") : t("Votre zone")}</p>
            <ul className="space-y-2">
              {(zones.data ?? []).map((z) => (
                <li key={z.id}>
                  <button
                    onClick={() => {
                      savePlace({ zoneId: z.id, label: z.name });
                      setOpen(false);
                    }}
                    className={`w-full rounded-xl border p-3 text-left text-sm ${!place?.addressId && place?.zoneId === z.id ? "border-emerald-600 bg-emerald-50 font-medium" : "border-stone-200"}`}
                  >
                    {z.name}
                  </button>
                </li>
              ))}
            </ul>
            <Link href={session ? "/app/adresses?nouvelle=1" : "/app/connexion?suite=/app/adresses"} className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Icon name="plus" className="h-4 w-4" /> {t("Enregistrer une adresse")}
            </Link>
          </DialogBox>
        </div>
      )}
    </>
  );
}
