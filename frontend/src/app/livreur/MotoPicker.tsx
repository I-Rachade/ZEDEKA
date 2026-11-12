"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { primary, secondary } from "@/app/app/ui";
import { driverFetch, driverImage, type FleetBike } from "@/lib/driver";
import { useT } from "@/lib/i18n/client";

function BikePhoto({ bike }: { bike: FleetBike }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bike.hasPhoto) return;
    let local: string | null = null;
    driverImage(`/motorbikes/${bike.id}/photo`).then((u) => setUrl((local = u)));
    return () => {
      if (local) URL.revokeObjectURL(local);
    };
  }, [bike.id, bike.hasPhoto]);
  return (
    <span className="grid h-14 w-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-stone-100">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Icon name="rider" className="h-6 w-6 text-stone-400" />}
    </span>
  );
}

// Salarié qui commence son service : il choisit une moto libre du parc Zedeka, puis passe en ligne avec.
export default function MotoPicker({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [bikes, setBikes] = useState<FleetBike[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    driverFetch<FleetBike[]>("/motorbikes").then(
      (b) => {
        setBikes(b);
        setChosen((c) => (c && b.some((x) => x.id === c) ? c : (b[0]?.id ?? null)));
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => {
    load();
  }, []);

  async function start() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await driverFetch("/online", { method: "PATCH", body: { online: true, motorbikeId: chosen } });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby="moto-title" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
        <h2 id="moto-title" className="text-xl font-bold">
          {t("Quelle moto prenez-vous ?")}
        </h2>
        <p className="mt-1 text-sm text-stone-600">{t("Choisissez la moto du parc Zedeka avec laquelle vous travaillez. Le client verra sa plaque. Vous la rendez en passant hors ligne.")}</p>
        {!bikes ? (
          <p className="py-6 text-center text-sm text-stone-500">{error ?? t("Chargement…")}</p>
        ) : bikes.length === 0 ? (
          <p className="my-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{t("Aucune moto libre en ce moment. Appelez la répartition.")}</p>
        ) : (
          <ul className="my-4 space-y-2" role="radiogroup" aria-label={t("Motos libres")}>
            {bikes.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen === b.id}
                  onClick={() => setChosen(b.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl border-2 p-2 text-left ${chosen === b.id ? "border-emerald-600 bg-emerald-50" : "border-stone-200"}`}
                >
                  <BikePhoto bike={b} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[17px] font-bold tracking-wide">{b.plate}</span>
                    {b.label && <span className="block truncate text-sm text-stone-600">{b.label}</span>}
                  </span>
                  {chosen === b.id && <Icon name="check" className="h-6 w-6 text-emerald-700" />}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && bikes && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div className="space-y-2">
          <button onClick={start} disabled={!chosen || busy} className={primary}>
            {busy ? t("Un instant…") : t("Prendre cette moto et passer en ligne")}
          </button>
          <button onClick={onClose} className={secondary}>
            {t("Annuler")}
          </button>
        </div>
      </div>
    </div>
  );
}
