"use client";

import "leaflet/dist/leaflet.css";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { GeoPoint } from "@/lib/api";

// Carte de la page Course : le client au centre (point vert et halo du rayon d'appel), les Zed libres autour.
export default function NearbyMap({ me, radiusM, drivers }: { me: GeoPoint; radiusM: number; drivers: GeoPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const state = useRef<{ map: LeafletMap; layer: LayerGroup; L: typeof import("leaflet") } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const map = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([me.latitude, me.longitude], 15);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      L.circle([me.latitude, me.longitude], { radius: radiusM, color: "#059669", weight: 0, fillColor: "#10b981", fillOpacity: 0.14 }).addTo(map);
      L.marker([me.latitude, me.longitude], {
        icon: L.divIcon({
          html: '<span class="zd-me"></span>',
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
        interactive: false,
      }).addTo(map);
      state.current = { map, layer: L.layerGroup().addTo(map), L };
      setReady(true);
    });
    return () => {
      cancelled = true;
      state.current?.map.remove();
      state.current = null;
    };
    // Centre et rayon posés une fois ; les Zed se redessinent dans l'effet suivant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = state.current;
    if (!s) return;
    s.layer.clearLayers();
    for (const d of drivers)
      s.L.marker([d.latitude, d.longitude], {
        icon: s.L.divIcon({ html: '<span class="zd-moto">🛵</span>', className: "", iconSize: [34, 34], iconAnchor: [17, 17] }),
        interactive: false,
      }).addTo(s.layer);
  }, [ready, drivers]);

  return <div ref={box} className="h-full w-full" data-noswipe aria-hidden="true" />;
}
