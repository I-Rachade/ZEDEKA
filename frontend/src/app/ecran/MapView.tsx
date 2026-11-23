"use client";

import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { addBaseLayer } from "@/lib/mapTiles";
import type { ScreenMap, ScreenSummary } from "@/lib/screen";
import { Feed, Leaderboard } from "./CounterView";

// Écran « carte » : restaurants et boutiques (vert : ouvert, gris : fermé ; pastille : commandes en cours), livreurs
// (vert : libre, jaune : en course, gris : sans position récente), et un trait vers le restaurant pour ceux qui vont
// chercher une commande. Pas de point de livraison : l'adresse d'un client ne s'affiche pas au bureau.

const LOME: [number, number] = [6.1319, 1.2228];
const COLORS = { FREE: "#10b981", BUSY: "#facc15", STALE: "#9ca3af" } as const;

function Count({ value, label, tone = "text-white", alert = false }: { value: number; label: string; tone?: string; alert?: boolean }) {
  return (
    <div className={`rounded-2xl px-[1vw] py-[1vh] shadow-xl ring-1 backdrop-blur ${alert ? "bg-red-600/80 ring-red-300" : "bg-stone-950/80 ring-white/10"}`}>
      <p className={`font-display text-[2.6vw] font-extrabold leading-tight tabular-nums ${tone}`}>{value}</p>
      <p className="text-[0.95vw] font-semibold text-stone-300">{label}</p>
    </div>
  );
}

export default function MapView({ map: data, summary, fresh }: { map: ScreenMap; summary: ScreenSummary | null; fresh: Set<string> }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const leaflet = useRef<{ map: LeafletMap; layer: LayerGroup; L: typeof import("leaflet"); fitted: boolean } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const map = L.map(box.current, { zoomControl: false, attributionControl: true }).setView(LOME, 13);
      addBaseLayer(L, map);
      leaflet.current = { map, layer: L.layerGroup().addTo(map), L, fitted: false };
      setReady(true);
    });
    return () => {
      cancelled = true;
      leaflet.current?.map.remove();
      leaflet.current = null;
    };
  }, []);

  useEffect(() => {
    const s = leaflet.current;
    if (!ready || !s) return;
    const { L, layer, map } = s;
    layer.clearLayers();
    const icon = (html: string, size: number) => L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
    const pts: [number, number][] = [];
    const places = new Map(data.restaurants.map((r) => [r.id, r]));

    // Traits livreur → restaurant (course en route vers le retrait).
    for (const d of data.drivers) {
      const r = d.phase === "PICKUP" && d.restaurantId ? places.get(d.restaurantId) : null;
      if (r)
        L.polyline(
          [
            [d.latitude, d.longitude],
            [r.latitude, r.longitude],
          ],
          { color: COLORS.BUSY, weight: 4, dashArray: "6 10", opacity: 0.9 },
        ).addTo(layer);
    }
    for (const r of data.restaurants) {
      const ring = r.open ? COLORS.FREE : "#6b7280";
      const badge = r.activeOrders
        ? `<span style="position:absolute;top:-8px;right:-8px;min-width:22px;height:22px;padding:0 5px;border-radius:9999px;background:#ef4444;color:#fff;font:800 13px/22px system-ui;text-align:center;border:2px solid #fff">${r.activeOrders}</span>`
        : "";
      L.marker([r.latitude, r.longitude], {
        icon: icon(
          `<span style="position:relative;display:grid;place-items:center;width:34px;height:34px;border-radius:9999px;background:#fff;border:3px solid ${ring};box-shadow:0 2px 6px rgb(0 0 0/.4);font-size:17px;opacity:${r.open ? 1 : 0.6}">${r.kind === "SHOP" ? "🛍️" : "🍽️"}${badge}</span>`,
          34,
        ),
        title: r.name,
        zIndexOffset: r.activeOrders ? 500 : 0,
      }).addTo(layer);
      pts.push([r.latitude, r.longitude]);
    }
    for (const d of data.drivers) {
      const color = COLORS[d.state];
      const pulse = d.state !== "STALE" ? `<span class="screen-pulse" style="position:absolute;inset:-8px;border-radius:9999px;background:${color}"></span>` : "";
      L.marker([d.latitude, d.longitude], {
        icon: icon(
          `<span style="position:relative;display:grid;place-items:center;width:38px;height:38px">${pulse}<span style="position:relative;display:grid;place-items:center;width:38px;height:38px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgb(0 0 0/.4);font-size:19px">🛵</span></span>`,
          38,
        ),
        zIndexOffset: 1000,
      })
        .bindTooltip(d.name, { permanent: true, direction: "bottom", offset: [0, 20], className: "screen-label" })
        .addTo(layer);
      pts.push([d.latitude, d.longitude]);
    }
    // Cadrage sur tout le monde au premier affichage, puis seulement si quelqu'un sort de la carte.
    if (pts.length > 1) {
      const bounds = L.latLngBounds(pts);
      if (!s.fitted || !map.getBounds().contains(bounds)) {
        // En haut, la place des compteurs posés sur la carte.
        map.fitBounds(bounds, { paddingTopLeft: [60, 200], paddingBottomRight: [60, 90], maxZoom: 15, animate: s.fitted });
        s.fitted = true;
      }
    }
  }, [ready, data]);

  // La carte peut être montée cachée (rotation) : elle reprend sa taille quand elle réapparaît.
  useEffect(() => {
    const s = leaflet.current;
    if (!s || !box.current) return;
    const ro = new ResizeObserver(() => s.map.invalidateSize());
    ro.observe(box.current);
    return () => ro.disconnect();
  }, [ready]);

  const c = data.counts;
  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_24vw] gap-[1.2vw]">
      <div className="relative min-h-0 overflow-hidden rounded-3xl ring-1 ring-white/10">
        <div ref={box} className="absolute inset-0 z-0 bg-stone-800" />
        <div className="pointer-events-none absolute inset-x-[1vw] top-[1vw] z-[500] flex flex-wrap gap-[0.8vw]">
          <Count value={c.driversOnline} label={t("livreurs en ligne")} tone="text-emerald-300" />
          <Count value={c.driversFree} label={t("libres")} tone="text-emerald-300" />
          <Count value={c.driversBusy} label={t("en course")} tone="text-yellow-300" />
          <Count value={c.restaurantsOpen} label={t("restaurants ouverts")} />
          {c.shopsOpen > 0 && <Count value={c.shopsOpen} label={t("boutiques ouvertes")} />}
          <Count value={c.inKitchen} label={t("en cuisine")} tone="text-orange-300" />
          <Count value={c.onTheRoad} label={t("en route")} tone="text-cyan-300" />
          <Count value={c.toDispatch} label={t("à affecter")} alert={c.toDispatch > 0} />
        </div>
        <div className="pointer-events-none absolute bottom-[1vw] left-[1vw] z-[500] flex gap-[1vw] rounded-2xl bg-stone-950/80 px-[1vw] py-[0.8vh] text-[1vw] font-semibold ring-1 ring-white/10">
          {(
            [
              [COLORS.FREE, "Libre"],
              [COLORS.BUSY, "En course"],
              [COLORS.STALE, "Sans position récente"],
            ] as const
          ).map(([color, label]) => (
            <span key={label} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: color }} />
              {t(label)}
            </span>
          ))}
          <span className="flex items-center gap-2">
            <span className="h-0.5 w-6 border-t-4 border-dashed border-yellow-300" />
            {t("Vers le restaurant")}
          </span>
        </div>
      </div>
      <div className="flex min-h-0 flex-col gap-[1.2vw]">
        <div className="rounded-2xl bg-gradient-to-br from-emerald-600/40 to-stone-900 p-[1vw] ring-1 ring-emerald-400/30">
          <p className="text-[1.2vw] font-semibold text-emerald-200">{t("Livraisons aujourd'hui")}</p>
          <p className="font-display text-[6vw] font-extrabold leading-none tabular-nums">{summary?.today.delivered ?? c.deliveredToday}</p>
          {summary && (
            <div className="mt-[1vh] h-[1.6vh] overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300" style={{ width: `${Math.min(100, (summary.today.delivered / Math.max(1, summary.goal.target)) * 100)}%` }} />
            </div>
          )}
          {summary && <p className="mt-1 text-[1vw] text-stone-300">🎯 {t("Objectif du jour : {n}", { n: summary.goal.target })}</p>}
        </div>
        {summary && <Leaderboard rows={summary.leaderboard} compact />}
        {summary && <Feed rows={summary.feed} fresh={fresh} limit={2} />}
      </div>
    </div>
  );
}
