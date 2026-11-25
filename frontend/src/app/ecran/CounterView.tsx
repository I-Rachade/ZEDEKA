"use client";

import { useT } from "@/lib/i18n/client";
import type { Category, ScreenSummary } from "@/lib/screen";

// Écran « compteur » : le grand chiffre des livraisons du jour, la jauge de l'objectif, le record, les chiffres du
// jour, les commandes heure par heure (aujourd'hui contre hier), le classement des livreurs et le fil en direct.

export const CATEGORY: Record<Category, { label: string; emoji: string; color: string }> = {
  FOOD: { label: "Repas", emoji: "🍽️", color: "#10b981" },
  PARCEL: { label: "Colis", emoji: "📦", color: "#38bdf8" },
  SHOP: { label: "Boutique", emoji: "🛍️", color: "#f472b6" },
};

export const STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "Reçue", tone: "bg-amber-400/20 text-amber-300" },
  CONFIRMED: { label: "Acceptée", tone: "bg-sky-400/20 text-sky-300" },
  PREPARING: { label: "En cuisine", tone: "bg-orange-400/20 text-orange-300" },
  READY: { label: "Prête", tone: "bg-violet-400/20 text-violet-300" },
  PICKED_UP: { label: "En route", tone: "bg-cyan-400/20 text-cyan-300" },
  DELIVERED: { label: "Livrée", tone: "bg-emerald-400/20 text-emerald-300" },
  CANCELLED: { label: "Annulée", tone: "bg-stone-500/20 text-stone-400" },
};

const MEDALS = ["🥇", "🥈", "🥉"];

export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function Tile({ label, value, unit, hint, accent }: { label: string; value: string | number; unit?: string; hint?: string; accent?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white/[0.06] px-[1vw] py-[1.2vh] ring-1 ring-white/10">
      <p className="truncate text-[1vw] font-semibold text-stone-400">{label}</p>
      <p className="truncate font-display text-[2.8vw] font-extrabold leading-tight tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
        {unit && <span className="ml-1 text-[1.3vw] font-semibold text-stone-400">{unit}</span>}
      </p>
      {hint && <p className="truncate text-[0.85vw] text-stone-500">{hint}</p>}
    </div>
  );
}

// Barres des commandes reçues par heure ; derrière, en gris, la même heure hier.
function Hourly({ today, yesterday, hour }: { today: number[]; yesterday: number[]; hour: number }) {
  const t = useT();
  // De 7 h à 23 h : les heures de service.
  const hours = Array.from({ length: 17 }, (_, i) => 7 + i);
  const max = Math.max(1, ...hours.map((h) => Math.max(today[h], yesterday[h])));
  return (
    <div className="flex h-full flex-col rounded-2xl bg-white/[0.06] p-[1vw] ring-1 ring-white/10">
      <div className="flex items-center justify-between">
        <p className="text-[1.2vw] font-bold">{t("Commandes heure par heure")}</p>
        <p className="flex items-center gap-[1vw] text-[0.95vw] text-stone-400">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-emerald-400" />
            {t("Aujourd'hui")}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm bg-white/15" />
            {t("Hier")}
          </span>
        </p>
      </div>
      <div className="mt-[1vh] flex min-h-0 flex-1 items-stretch gap-[0.5vw]">
        {hours.map((h) => (
          <div key={h} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="relative w-full flex-1">
              <div className="absolute inset-x-[10%] bottom-0 rounded-t-md bg-white/15" style={{ height: `${(yesterday[h] / max) * 85}%` }} />
              <div
                className={`absolute inset-x-[22%] bottom-0 rounded-t-md transition-[height] duration-700 ${h === hour ? "bg-yellow-400" : "bg-emerald-400"} ${h > hour ? "opacity-0" : ""}`}
                style={{ height: `${(today[h] / max) * 85}%` }}
              >
                {today[h] > 0 && <span className="absolute -top-[2.6vh] left-1/2 -translate-x-1/2 text-[1vw] font-bold tabular-nums">{today[h]}</span>}
              </div>
            </div>
            <span className={`mt-1 text-[0.85vw] tabular-nums ${h === hour ? "font-bold text-yellow-300" : "text-stone-400"}`}>{h}h</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Leaderboard({ rows, compact = false }: { rows: ScreenSummary["leaderboard"]; compact?: boolean }) {
  const t = useT();
  const shown = rows.slice(0, compact ? 4 : 5);
  const best = shown[0]?.deliveries ?? 1;
  return (
    <div className="rounded-2xl bg-white/[0.06] p-[1vw] ring-1 ring-white/10">
      <p className="text-[1.2vw] font-bold">🏆 {t("Livreurs du jour")}</p>
      {shown.length === 0 ? (
        <p className="mt-2 text-[1vw] text-stone-400">{t("Première livraison du jour : qui ouvre le classement ?")}</p>
      ) : (
        <ol className="mt-[1vh] space-y-[0.8vh]">
          {shown.map((r, i) => (
            <li key={r.id} className="relative overflow-hidden rounded-xl bg-white/[0.04] px-[0.8vw] py-[0.7vh]">
              <span className="absolute inset-y-0 left-0 bg-emerald-500/15" style={{ width: `${(r.deliveries / best) * 100}%` }} />
              <span className="relative flex items-center gap-[0.8vw] text-[1.2vw]">
                <span className="w-[2vw] text-center">{MEDALS[i] ?? <span className="text-stone-400">{i + 1}</span>}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                {r.avgMinutes != null && !compact && <span className="text-[0.95vw] text-stone-400">⚡ {t("{n} min", { n: r.avgMinutes })}</span>}
                <span className="font-display text-[1.6vw] font-extrabold tabular-nums text-emerald-300">{r.deliveries}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function Feed({ rows, fresh, limit }: { rows: ScreenSummary["feed"]; fresh: Set<string>; limit: number }) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-col rounded-2xl bg-white/[0.06] p-[1vw] ring-1 ring-white/10">
      <p className="flex items-center gap-2 text-[1.2vw] font-bold">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
        </span>
        {t("En direct")}
      </p>
      {rows.length === 0 ? (
        <p className="mt-2 text-[1vw] text-stone-400">{t("Pas encore de commande aujourd'hui.")}</p>
      ) : (
        <ul className="mt-[1vh] space-y-[0.7vh] overflow-hidden">
          {rows.slice(0, limit).map((o) => {
            const c = CATEGORY[o.category];
            const s = STATUS[o.status] ?? STATUS.PENDING;
            return (
              <li key={o.code} className={`flex items-center gap-[0.8vw] rounded-xl px-[0.8vw] py-[0.6vh] text-[1.05vw] ${fresh.has(o.code) ? "screen-new bg-emerald-500/25" : "bg-white/[0.04]"}`}>
                <span className="text-[1.4vw]">{c.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{o.from ?? t(c.label)}</span>
                  <span className="block truncate text-[0.9vw] text-stone-400">
                    {o.code}
                    {o.zone ? ` · ${o.zone}` : ""} · {hhmm(o.createdAt)}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-[0.6vw] py-[0.2vh] text-[0.9vw] font-semibold ${s.tone}`}>{t(s.label)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function CounterView({ data, fresh }: { data: ScreenSummary; fresh: Set<string> }) {
  const t = useT();
  const { today, goal, record, yesterday } = data;
  const pct = Math.min(100, Math.round((today.delivered / Math.max(1, goal.target)) * 100));
  const left = goal.target - today.delivered;
  const diff = today.delivered - yesterday.deliveredSoFar;
  const hour = new Date(data.now).getUTCHours();
  const recordDate = record ? new Date(`${record.date}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" }) : null;
  const beatRecord = record != null && today.delivered > record.count;

  return (
    <div className="grid h-full min-h-0 grid-cols-[2fr_1fr] gap-[1.2vw]">
      <div className="flex min-h-0 flex-col gap-[1.2vw]">
        {/* Le grand chiffre et la jauge de l'objectif */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600/40 via-emerald-800/30 to-stone-900 p-[1.6vw] ring-1 ring-emerald-400/30">
          <div className="flex items-end justify-between gap-[2vw]">
            <div>
              <p className="text-[1.5vw] font-semibold text-emerald-200">{t("Livraisons aujourd'hui")}</p>
              <p key={today.delivered} className="screen-pop font-display text-[11vw] font-extrabold leading-none tabular-nums">
                {today.delivered}
              </p>
            </div>
            <div className="space-y-[1vh] pb-[1vh] text-right">
              <p className={`text-[1.6vw] font-bold ${diff >= 0 ? "text-emerald-300" : "text-amber-300"}`}>
                {diff >= 0 ? "▲" : "▼"} {t("{n} par rapport à hier à la même heure", { n: `${diff >= 0 ? "+" : ""}${diff}` })}
              </p>
              {record && (
                <p className={`text-[1.4vw] font-semibold ${beatRecord ? "text-yellow-300" : "text-stone-300"}`}>
                  {beatRecord ? `🏅 ${t("Nouveau record ! (ancien : {n})", { n: record.count })}` : `🏅 ${t("Record : {n} le {date}", { n: record.count, date: recordDate ?? "" })}`}
                </p>
              )}
            </div>
          </div>
          <div className="mt-[1.6vh]">
            <div className="flex items-baseline justify-between text-[1.3vw] font-semibold">
              <span>
                🎯 {t("Objectif du jour : {n}", { n: goal.target })}
                {goal.auto && <span className="text-[1vw] font-normal text-stone-400"> · {t("calculé sur les 7 derniers jours")}</span>}
              </span>
              <span className={left <= 0 ? "text-yellow-300" : "text-emerald-200"}>
                {left <= 0 ? t("Objectif atteint ! Encore plus haut 🚀") : t("Encore {n} livraisons", { n: left })}
              </span>
            </div>
            <div className="mt-[1vh] h-[3.2vh] overflow-hidden rounded-full bg-black/40 ring-1 ring-white/10">
              <div
                className={`flex h-full items-center justify-end rounded-full pr-3 text-[1.1vw] font-extrabold transition-[width] duration-1000 ${left <= 0 ? "bg-gradient-to-r from-yellow-400 to-orange-400 text-stone-900" : "bg-gradient-to-r from-emerald-500 to-emerald-300 text-emerald-950"}`}
                style={{ width: `${Math.max(pct, 6)}%` }}
              >
                {pct}%
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-6 gap-[1vw]">
          <Tile label={t("Reçues")} value={today.received} hint={t("hier : {n}", { n: yesterday.createdSoFar })} />
          <Tile label={t("En cours")} value={today.inProgress} accent="#facc15" />
          <Tile label={`${CATEGORY.FOOD.emoji} ${t("Repas")}`} value={today.byCategory.FOOD} accent={CATEGORY.FOOD.color} />
          <Tile label={`${CATEGORY.PARCEL.emoji} ${t("Colis")}`} value={today.byCategory.PARCEL} accent={CATEGORY.PARCEL.color} />
          <Tile label={`${CATEGORY.SHOP.emoji} ${t("Boutiques")}`} value={today.byCategory.SHOP} accent={CATEGORY.SHOP.color} />
          <Tile
            label={t("Temps moyen")}
            value={today.avgMinutes ?? "–"}
            unit={today.avgMinutes != null ? t("min") : undefined}
            hint={today.zedRides ? t("{n} courses Zed", { n: today.zedRides }) : today.cancelled ? t("{n} annulée(s)", { n: today.cancelled }) : undefined}
          />
        </div>

        <div className="min-h-0 flex-1">
          <Hourly today={data.hourly} yesterday={data.hourlyYesterday} hour={hour} />
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-[1.2vw]">
        <Leaderboard rows={data.leaderboard} />
        <Feed rows={data.feed} fresh={fresh} limit={5} />
      </div>
    </div>
  );
}
