"use client";

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { GeoPoint } from "@/lib/api";

const dot = (bg: string, ring: string, emoji: string, size = 40) =>
  `<span style="display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};box-shadow:0 0 0 ${size / 4}px ${ring};font-size:${size / 2}px">${emoji}</span>`;

// Carte du suivi pendant le trajet : départ (restaurant ou retrait), arrivée (épingle rouge) et la moto du livreur,
// qui glisse vers chaque nouvelle position. Pointillés de la moto à l'arrivée, trait plein du départ à la moto.
export default function LiveMap({ from, to, driver, fromEmoji = "🍗" }: { from: GeoPoint | null; to: GeoPoint | null; driver: GeoPoint | null; fromEmoji?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const state = useRef<{ map: LeafletMap; moto?: Marker; done?: Polyline; ahead?: Polyline; L: typeof import("leaflet") } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const map = L.map(box.current, { zoomControl: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      const icon = (html: string, size: number) => L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      if (from) L.marker([from.latitude, from.longitude], { icon: icon(dot("#fff", "rgb(4 120 87 / .9)", fromEmoji, 30), 30), interactive: false }).addTo(map);
      if (to)
        L.marker([to.latitude, to.longitude], {
          icon: L.divIcon({
            html: '<svg width="34" height="44" viewBox="0 0 34 44"><path d="M17 0C7.6 0 0 7.4 0 16.6 0 29 17 44 17 44s17-15 17-27.4C34 7.4 26.4 0 17 0z" fill="#e5484d"/><circle cx="17" cy="16" r="6.5" fill="#fff"/></svg>',
            className: "",
            iconSize: [34, 44],
            iconAnchor: [17, 44],
          }),
          interactive: false,
        }).addTo(map);
      state.current = { map, L };
      setReady(true);
      const pts = [from, to, driver].filter((p): p is GeoPoint => Boolean(p)).map((p) => L.latLng(p.latitude, p.longitude));
      if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 16 });
      else if (pts[0]) map.setView(pts[0], 15);
    });
    return () => {
      cancelled = true;
      state.current?.map.remove();
      state.current = null;
    };
    // Fond et points fixes posés une fois ; la moto suit dans l'effet suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = state.current;
    if (!s || !driver) return;
    const { L, map } = s;
    const at = L.latLng(driver.latitude, driver.longitude);
    if (!s.moto) s.moto = L.marker(at, { icon: L.divIcon({ html: dot("#fbbf24", "rgb(251 191 36 / .3)", "🛵", 40), className: "", iconSize: [40, 40], iconAnchor: [20, 20] }), interactive: false }).addTo(map);
    else s.moto.setLatLng(at);
    s.done?.remove();
    s.ahead?.remove();
    if (from) s.done = L.polyline([[from.latitude, from.longitude], at], { color: "#047857", weight: 4, opacity: 0.45 }).addTo(map);
    if (to) s.ahead = L.polyline([at, [to.latitude, to.longitude]], { color: "#047857", weight: 4, dashArray: "2 10", lineCap: "round" }).addTo(map);
  }, [ready, driver, from, to]);

  return <div ref={box} className="h-full w-full" data-noswipe aria-hidden="true" />;
}
