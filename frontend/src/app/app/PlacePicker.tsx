"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { customerFetch, savePlace, usePlace, useSession, type Address, type Profile } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { useZones } from "./data";

// « Livrer à » : adresse enregistrée ou simple zone. Détermine les frais et l'ordre des restaurants.
export default function PlacePicker() {
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

  const zoneName = zones.data?.find((z) => z.id === place?.zoneId)?.name;

  return (
    <>
      <button data-place-picker onClick={() => setOpen(true)} className="flex w-full min-w-0 items-center gap-2 text-left">
        <Icon name="pin" className="h-5 w-5 shrink-0 text-emerald-600" />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-stone-500">{t("Livrer à")}</span>
          <span className="block truncate font-semibold">{place ? (place.addressId ? place.label : (zoneName ?? place.label)) : t("Choisir ma zone")}</span>
        </span>
        <span className="shrink-0 rotate-90 text-stone-400">
          <Icon name="chevron" className="h-4 w-4" />
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label={t("Où livrer ?")}
            onClick={(e) => e.stopPropagation()}
            className="mx-auto max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-stone-300" />
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
                      <Icon name="pin" className="mt-0.5 h-5 w-5 text-stone-500" />
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
          </div>
        </div>
      )}
    </>
  );
}
