"use client";

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { input, primary, secondary } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { searchPlaces, type PlaceResult } from "@/lib/api";
import { useT } from "@/lib/i18n/client";

export type Point = { latitude: number; longitude: number };

// Centre de Lomé, quand aucune position n'est encore connue.
const LOME: Point = { latitude: 6.1375, longitude: 1.2123 };

// Carte plein écran pour placer un point : on déplace la carte sous l'épingle fixe, puis on valide.
// Fond OpenStreetMap ; Leaflet est chargé seulement à l'ouverture. Rendue dans <body> : elle a son propre formulaire
// (lien collé) et peut s'ouvrir depuis un autre formulaire.
export default function MapPicker({ title, initial, onPick, onClose }: { title: string; initial?: Point | null; onPick: (p: Point) => void; onClose: () => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const [locating, setLocating] = useState(false);
  const [from] = useState(initial ?? null);
  const [query, setQuery] = useState("");
  const [searchState, setSearchState] = useState<"idle" | "loading" | "error" | "empty">("idle");
  const [searchError, setSearchError] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);

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

  // Recherche d'un lieu par son nom, ou lien Google Maps collé : un seul résultat centre la carte dessus,
  // plusieurs s'affichent en liste. On vérifie l'épingle puis on valide.
  async function search() {
    if (query.trim().length < 3) return;
    setSearchState("loading");
    setResults([]);
    try {
      const found = await searchPlaces(query.trim());
      if (found.length === 0) return setSearchState("empty");
      if (found.length === 1) go(found[0]);
      else setResults(found);
      setSearchState("idle");
    } catch (e) {
      setSearchError((e as Error).message);
      setSearchState("error");
    }
  }

  function go(p: PlaceResult) {
    map.current?.setView([p.latitude, p.longitude], 18);
    setResults([]);
  }

  function confirm() {
    const c = map.current?.getCenter();
    if (c) onPick({ latitude: c.lat, longitude: c.lng });
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t(title)} className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="hairline-b flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={onClose} className="text-[17px] text-emerald-600">
          {t("Annuler")}
        </button>
        <h2 className="flex-1 text-center text-[17px] font-semibold">{t(title)}</h2>
        <span className="w-14" />
      </div>
      <div className="space-y-2 px-4 py-2">
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchState("idle");
            }}
            type="search"
            enterKeyHint="search"
            placeholder={t("Rechercher un lieu, ou coller un lien Google Maps")}
            aria-label={t("Rechercher un lieu")}
            className={`${input} min-w-0 flex-1`}
          />
          <button type="submit" disabled={query.trim().length < 3 || searchState === "loading"} className="shrink-0 rounded-xl bg-emerald-600 px-3 font-semibold text-white disabled:opacity-40">
            {searchState === "loading" ? "…" : t("Chercher")}
          </button>
        </form>
        {searchState === "empty" && <p className="text-sm text-stone-600">{t("Aucun lieu trouvé. Essayez un quartier ou un repère connu, ou déplacez la carte.")}</p>}
        {searchState === "error" && <p className="text-sm text-red-700">{searchError}</p>}
        {results.length > 0 && (
          <ul className="max-h-56 divide-y divide-stone-100 overflow-auto rounded-xl bg-white ring-1 ring-stone-200">
            {results.map((r) => (
              <li key={`${r.latitude},${r.longitude}`}>
                <button type="button" onClick={() => go(r)} className="block w-full px-3 py-2.5 text-left active:bg-stone-100">
                  <span className="block font-medium">{r.name}</span>
                  {r.detail && <span className="block text-sm text-stone-500">{r.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative flex-1">
        <div ref={box} className="absolute inset-0" />
        {/* Épingle fixe au centre : le point retenu est le centre de la carte. */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full text-emerald-700 drop-shadow">
          <Icon name="pin" className="h-10 w-10" />
        </span>
      </div>
      <div className="space-y-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <p className="text-center text-sm text-stone-500">{t("Déplacez la carte pour mettre l'épingle sur le bon endroit.")}</p>
        <button type="button" onClick={here} disabled={locating} className={secondary}>
          {locating ? t("Recherche…") : t("Aller à ma position actuelle")}
        </button>
        <button type="button" onClick={confirm} className={primary}>
          {t("Valider ce point")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
