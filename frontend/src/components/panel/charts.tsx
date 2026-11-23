"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

// Petits graphiques des écrans « Indicateurs » et « Performance » de l'admin, sans bibliothèque :
// colonnes (empilées si plusieurs séries) avec légende et détail au survol, et tuiles avec tendance.

export type Series = { key: string; label: string; color: string };

// Couleurs des séries, toujours dans cet ordre (vérifiées pour les daltonismes courants).
export const SERIES_COLORS = ["#059669", "#0284c7", "#d97706", "#7c3aed", "#db2777"] as const;

export function ColumnChart<R extends Record<string, unknown>>({
  rows,
  series,
  labelOf,
  format = (v) => String(v),
  height = 140,
  empty = "Pas encore de données sur la période.",
}: {
  rows: R[];
  series: Series[];
  labelOf: (row: R) => string;
  format?: (v: number) => string;
  height?: number;
  empty?: string;
}) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const value = (r: R, key: string) => (typeof r[key] === "number" ? (r[key] as number) : 0);
  const totals = rows.map((r) => series.reduce((s, x) => s + value(r, x.key), 0));
  const max = Math.max(1, ...totals);
  if (!totals.some((v) => v > 0)) return <p className="text-sm text-stone-500">{t(empty)}</p>;
  const shown = hover ?? totals.length - 1;
  const gap = rows.length > 40 ? 1 : 2;

  return (
    <div>
      {/* Détail de la colonne survolée (par défaut : la dernière). */}
      <p className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600" aria-live="polite">
        <span className="font-semibold text-stone-800">{labelOf(rows[shown])}</span>
        {series.length > 1 && <span>{t("Total")} : {format(totals[shown])}</span>}
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            {series.length > 1 && <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />}
            {series.length > 1 ? `${t(s.label)} : ` : ""}
            {format(value(rows[shown], s.key))}
          </span>
        ))}
      </p>
      <div className="flex items-end" style={{ height, gap }} onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <button
            type="button"
            key={i}
            className={`flex h-full min-w-0 flex-1 flex-col-reverse rounded-t ${hover === i ? "bg-stone-100" : ""}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            aria-label={`${labelOf(r)} : ${format(totals[i])}`}
          >
            {series.map((s, j) => {
              const v = value(r, s.key);
              if (!v) return null;
              const last = series.slice(j + 1).every((x) => !value(r, x.key));
              return (
                <span
                  key={s.key}
                  className={`block w-full ${last ? "rounded-t" : ""}`}
                  style={{ height: `${(v / max) * 100}%`, background: s.color, marginTop: last ? 0 : 1 }}
                />
              );
            })}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-stone-500">
        <span>{labelOf(rows[0])}</span>
        <span>{labelOf(rows[rows.length - 1])}</span>
      </div>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-600">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
              {t(s.label)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Écart avec la période précédente : flèche, valeur et mot (jamais la couleur seule).
export function Trend({ now, before, better = "up", unit = "%" }: { now: number | null; before: number | null; better?: "up" | "down"; unit?: "%" | "pts" }) {
  const t = useT();
  if (now === null || before === null) return null;
  let diff: number;
  if (unit === "pts") diff = Math.round((now - before) * 10) / 10;
  else if (before === 0) return now === 0 ? <span className="text-xs text-stone-500">{t("stable")}</span> : <span className="text-xs text-stone-500">{t("nouveau")}</span>;
  else diff = Math.round(((now - before) / Math.abs(before)) * 100);
  if (diff === 0) return <span className="text-xs text-stone-500">= {t("stable")}</span>;
  const good = (diff > 0) === (better === "up");
  return (
    <span className={`text-xs font-medium ${good ? "text-emerald-700" : "text-red-700"}`}>
      {diff > 0 ? "▲" : "▼"} {diff > 0 ? "+" : ""}
      {diff} {unit === "pts" ? t("pts") : "%"} · {t(good ? "mieux" : "moins bien")}
    </span>
  );
}

export function KpiTile({
  label,
  value,
  hint,
  now,
  before,
  better = "up",
  unit,
}: {
  label: string;
  value: string | number;
  hint?: string;
  now?: number | null;
  before?: number | null;
  better?: "up" | "down";
  unit?: "%" | "pts";
}) {
  const t = useT();
  return (
    <div className="rounded-xl border border-stone-200 bg-surface p-4">
      <p className="text-sm text-stone-600">{t(label)}</p>
      <p className="text-2xl font-bold">{value}</p>
      <div className="flex flex-wrap items-center gap-x-2">
        {now !== undefined && before !== undefined && <Trend now={now} before={before} better={better} unit={unit} />}
        {hint && <span className="text-xs text-stone-500">{t(hint)}</span>}
      </div>
    </div>
  );
}
