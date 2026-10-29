"use client";

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";
import { useEffect, useRef } from "react";
import type { Point } from "@/components/MapPicker";
import { useT } from "@/lib/i18n/client";

export const mapsUrl = (p: Point) => `https://www.google.com/maps/search/?api=1&query=${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;

// Aperçu d'un point sur une petite carte fixe (OpenStreetMap), avec le retrait en gris s'il est connu,
// et un lien pour l'ouvrir dans un nouvel onglet.
export default function PointPreview({ point, pickup, children }: { point: Point; pickup?: Point | null; children?: React.ReactNode }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const m = L.map(box.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
      }).addTo(m);
      const drop = L.circleMarker([point.latitude, point.longitude], {
        radius: 9,
        color: "#fff",
        weight: 3,
        fillColor: "#047857",
        fillOpacity: 1,
      }).addTo(m);
      if (pickup) {
        L.circleMarker([pickup.latitude, pickup.longitude], {
          radius: 7,
          color: "#fff",
          weight: 2,
          fillColor: "#78716c",
          fillOpacity: 1,
        }).addTo(m);
        m.fitBounds(L.latLngBounds([drop.getLatLng(), [pickup.latitude, pickup.longitude]]), { padding: [24, 24], maxZoom: 16 });
      } else m.setView(drop.getLatLng(), 16);
      map.current = m;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seules les coordonnées comptent
  }, [point.latitude, point.longitude, pickup?.latitude, pickup?.longitude]);

  return (
    <div className="overflow-hidden rounded-[14px] bg-stone-100">
      <div ref={box} className="h-40 w-full" aria-label={t("Aperçu du point de livraison sur la carte")} role="img" />
      <div className="flex items-center gap-3 p-3 text-sm">
        <div className="min-w-0 flex-1">{children}</div>
        <a href={mapsUrl(point)} target="_blank" rel="noopener noreferrer" className="shrink-0 font-medium text-emerald-700 underline">
          {t("Voir sur la carte")}
        </a>
      </div>
    </div>
  );
}
