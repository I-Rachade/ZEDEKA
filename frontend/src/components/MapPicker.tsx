"use client";

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { input, primary, secondary } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { resolveMapsLink } from "@/lib/api";

export type Point = { latitude: number; longitude: number };

// Centre de Lomé, quand aucune position n'est encore connue.
const LOME: Point = { latitude: 6.1375, longitude: 1.2123 };

// Carte plein écran pour placer un point : on déplace la carte sous l'épingle fixe, puis on valide.
// Fond OpenStreetMap ; Leaflet est chargé seulement à l'ouverture.
export default function MapPicker({ title, initial, onPick, onClose }: { title: string; initial?: Point | null; onPick: (p: Point) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const [locating, setLocating] = useState(false);
  const [from] = useState(initial ?? null);
  const [link, setLink] = useState("");
  const [linkState, setLinkState] = useState<"idle" | "loading" | "error">("idle");
  const [linkError, setLinkError] = useState("");

  useEffect(() => {
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      const start = from ?? LOME;
      map.current = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([start.latitude, start.longitude], from ? 17 : 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map.current);
      L.control.zoom({ position: "topright" }).addTo(map.current);
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [from]);

  function here() {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        map.current?.setView([p.coords.latitude, p.coords.longitude], 18);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  // Lien copié depuis Google Maps (« Partager ») : la carte se centre dessus, on vérifie puis on valide.
  async function goToLink() {
    if (!link.trim()) return;
    setLinkState("loading");
    try {
      const p = await resolveMapsLink(link);
      map.current?.setView([p.latitude, p.longitude], 18);
      setLinkState("idle");
      setLink("");
    } catch (e) {
      setLinkError((e as Error).message);
      setLinkState("error");
    }
  }

  function confirm() {
    const c = map.current?.getCenter();
    if (c) onPick({ latitude: c.lat, longitude: c.lng });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="hairline-b flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={onClose} className="text-[17px] text-emerald-600">
          Annuler
        </button>
        <h2 className="flex-1 text-center text-[17px] font-semibold">{title}</h2>
        <span className="w-14" />
      </div>
      <div className="relative flex-1">
        <div ref={box} className="absolute inset-0" />
        {/* Épingle fixe au centre : le point retenu est le centre de la carte. */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full text-emerald-700 drop-shadow">
          <Icon name="pin" className="h-10 w-10" />
        </span>
      </div>
      <div className="space-y-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <p className="text-center text-sm text-stone-500">Déplacez la carte pour mettre l&apos;épingle sur le bon endroit.</p>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            goToLink();
          }}
        >
          <input
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setLinkState("idle");
            }}
            inputMode="url"
            placeholder="Ou collez un lien Google Maps"
            aria-label="Lien Google Maps"
            className={`${input} min-w-0 flex-1`}
          />
          <button type="submit" disabled={!link.trim() || linkState === "loading"} className="shrink-0 rounded-xl px-3 font-semibold text-emerald-700 disabled:opacity-40">
            {linkState === "loading" ? "…" : "Aller"}
          </button>
        </form>
        {linkState === "error" && <p className="text-sm text-red-700">{linkError}</p>}
        <button type="button" onClick={here} disabled={locating} className={secondary}>
          {locating ? "Recherche…" : "Aller à ma position actuelle"}
        </button>
        <button type="button" onClick={confirm} className={primary}>
          Valider ce point
        </button>
      </div>
    </div>
  );
}
