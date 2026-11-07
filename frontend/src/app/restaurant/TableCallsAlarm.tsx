"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { useRinging } from "@/components/panel/partner";
import { restaurantFetch, type PanelTableCall, type TableCalls } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";

// Sonnerie de table, dans tout l'espace restaurant (mode caisse compris) : un bandeau par table qui appelle.
// Ça sonne tant qu'un appel attend « J'arrive » ; plus vite quand la relance de 2 min est passée.
export default function TableCallsAlarm() {
  const t = useT();
  const [calls, setCalls] = useState<PanelTableCall[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(() => restaurantFetch<TableCalls>("/table-calls").then((r) => setCalls(r.calls), () => {}), []);
  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  const waiting = calls.filter((c) => c.status === "OPEN");
  const late = waiting.some((c) => c.reminded);
  const soundBlocked = useRinging(waiting.length > 0, late ? 1200 : 2500);

  if (!calls.length) return null;

  const act = async (c: PanelTableCall, to: "ack" | "done") => {
    setBusy(c.id);
    await restaurantFetch(`/table-calls/${c.id}/${to}`, { method: "POST" }).catch(() => {});
    await load();
    setBusy(null);
  };
  const what = (c: PanelTableCall) => {
    if (c.kind === "BILL") return c.payment === "MOBILE_MONEY" ? t("Addition · mobile money") : c.payment === "CASH" ? t("Addition · espèces") : t("Addition");
    if (c.kind === "OTHER") return c.note ?? t("Demande");
    return t("Appel serveur");
  };
  const ago = (iso: string) => {
    const min = Math.floor((now - Date.parse(iso)) / 60_000);
    return min < 1 ? t("à l'instant") : t("il y a {n} min", { n: min });
  };

  return (
    <div role="region" aria-label={t("Appels des tables")} className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-xl flex-col gap-2 print:hidden">
      {calls.map((c) => {
        const open = c.status === "OPEN";
        return (
          <div
            key={c.id}
            role={open ? "alert" : "status"}
            className={`flex items-center gap-3 rounded-2xl p-3 shadow-[0_8px_30px_rgb(0_0_0/0.25)] ${open ? (c.reminded ? "bg-red-600 text-white" : "bg-sun text-ink-deep") : "bg-emerald-700 text-white"}`}
          >
            <span className={`relative grid h-14 min-w-14 shrink-0 place-items-center rounded-xl px-2 text-2xl font-extrabold ${open ? "bg-white/90 text-ink-deep" : "bg-white/15"}`}>
              {open && <span className="anim-wave absolute inset-0 rounded-xl border-2 border-white" aria-hidden="true" />}
              {c.tableNumber}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-bold">
                <Icon name={c.kind === "BILL" ? "receipt" : "bell"} className={`h-4 w-4 shrink-0 ${open ? "anim-shake" : ""}`} />
                {t("Table {number}", { number: c.tableNumber })}
                {open && c.reminded && <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{t("Toujours en attente")}</span>}
              </p>
              <p className="truncate text-[15px]">{what(c)}</p>
              <p className="text-xs opacity-80">{open ? ago(c.rungAt) : c.ackBy ? t("{name} y va", { name: c.ackBy }) : t("Pris en charge")}</p>
            </div>
            {open ? (
              <button disabled={busy === c.id} onClick={() => act(c, "ack")} className="shrink-0 rounded-xl bg-ink-deep px-4 py-3 font-bold text-white disabled:opacity-60">
                {t("J'arrive")}
              </button>
            ) : (
              <button disabled={busy === c.id} onClick={() => act(c, "done")} className="shrink-0 rounded-xl bg-white px-4 py-3 font-bold text-emerald-800 disabled:opacity-60">
                {t("Fait")}
              </button>
            )}
          </div>
        );
      })}
      {soundBlocked && waiting.length > 0 && <p className="rounded-lg bg-night/90 px-3 py-2 text-center text-sm text-white">{t("Touchez l'écran une fois pour activer la sonnerie.")}</p>}
    </div>
  );
}
