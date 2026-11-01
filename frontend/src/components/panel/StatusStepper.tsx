"use client";

import { useT } from "@/lib/i18n/client";
import { Icon } from "./icons";
import { formatTime } from "@/lib/admin";

export type Step = { label: string; at: string | null };

// Frise horizontale des étapes : étapes franchies cochées avec leur heure, l'étape en cours mise en avant.
// Une course annulée affiche les étapes franchies puis l'arrêt.
export default function StatusStepper({ steps, stopped }: { steps: Step[]; stopped?: { label: string; at: string | null } }) {
  const t = useT();
  const reached = steps.reduce((last, s, i) => (s.at ? i : last), -1);
  const shown = stopped ? [...steps.slice(0, reached + 1), { ...stopped, stop: true }] : steps;

  return (
    <ol className="flex w-full items-start print:hidden">
      {shown.map((s, i) => {
        const done = Boolean(s.at);
        const stop = "stop" in s;
        const current = !stopped && i === reached;
        const last = i === shown.length - 1;
        return (
          <li key={s.label} className={`relative flex flex-1 flex-col items-center text-center ${last ? "" : ""}`}>
            {!last && (
              <span className={`absolute left-1/2 top-3.5 h-0.5 w-full ${i < reached || (stopped && i < shown.length - 1) ? "bg-emerald-500" : "bg-stone-200"}`} />
            )}
            <span
              className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border-2 text-xs font-semibold ${
                stop
                  ? "border-red-500 bg-red-500 text-white"
                  : done
                    ? `border-emerald-500 bg-emerald-500 text-white ${current ? "ring-4 ring-emerald-100" : ""}`
                    : "border-stone-300 bg-white text-stone-500"
              }`}
            >
              {stop ? <Icon name="close" className="h-4 w-4" /> : done ? <Icon name="check" className="h-4 w-4" /> : i + 1}
            </span>
            <span className={`mt-1.5 px-1 text-xs leading-tight ${done || stop ? "font-medium text-stone-800" : "text-stone-500"}`}>{t(s.label)}</span>
            {s.at && <span className="px-1 text-[11px] leading-tight text-stone-500">{formatTime(s.at)}</span>}
          </li>
        );
      })}
    </ol>
  );
}
