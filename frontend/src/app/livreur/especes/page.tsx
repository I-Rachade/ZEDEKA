"use client";

import { useEffect, useState } from "react";
import { card, Empty, Skeleton, TopBar } from "@/app/app/ui";
import { fcfa } from "@/lib/api";
import { driverFetch } from "@/lib/driver";
import { currentLang, dateLocale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";

type Cash = {
  total: number;
  orders: { id: string; code: string; total: number; amount: number; cashNote: string | null; deliveredAt: string }[];
  handovers: { id: string; amount: number; createdAt: string; orders: number }[];
};

const when = (iso: string) => new Date(iso).toLocaleString(dateLocale(currentLang()), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });

// Espèces encaissées et pas encore remises à Zedeka.
export default function CashPage() {
  const [data, setData] = useState<Cash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = useT();
  useEffect(() => {
    driverFetch<Cash>("/cash").then(setData, (e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <TopBar title="Espèces en main" />
      <div className="space-y-4 px-4 py-4">
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!data ? (
          !error && <Skeleton rows={2} />
        ) : (
          <>
            <section className="rounded-2xl bg-emerald-700 p-5 text-white">
              <p className="text-sm text-emerald-100">{t("À remettre à Zedeka")}</p>
              <p className="text-3xl font-bold">{fcfa(data.total)}</p>
              <p className="mt-1 text-sm text-emerald-100">{t("{n} livraison(s) payée(s) en espèces. Remettez la somme à la répartition en fin de service.", { n: data.orders.length })}</p>
            </section>
            <section className={card}>
              <h2 className="px-4 pt-4 font-semibold">{t("Détail")}</h2>
              {data.orders.length === 0 ? (
                <Empty icon="wallet" title="Aucune espèce en main" />
              ) : (
                <ul className="divide-y divide-stone-100">
                  {data.orders.map((o) => (
                    <li key={o.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                      <div>
                        <p className="font-medium">{o.code}</p>
                        <p className="text-stone-500">{when(o.deliveredAt)}</p>
                        {o.cashNote && <p className="text-amber-800">{t("Écart : {note} (total {total})", { note: o.cashNote, total: fcfa(o.total) })}</p>}
                      </div>
                      <p className="font-semibold">{fcfa(o.amount)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {data.handovers.length > 0 && (
              <section className={card}>
                <h2 className="px-4 pt-4 font-semibold">{t("Derniers versements")}</h2>
                <ul className="divide-y divide-stone-100">
                  {data.handovers.map((h) => (
                    <li key={h.id} className="flex justify-between px-4 py-3 text-sm">
                      <span>
                        {when(h.createdAt)} · {t("{n} course(s)", { n: h.orders })}
                      </span>
                      <span className="font-semibold">{fcfa(h.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
