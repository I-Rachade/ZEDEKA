// Fond de carte de toutes les cartes Zedeka (suivi, Zed à proximité, répartition, choix d'un point, navigation).
// Par défaut, notre propre carte du Togo (tuiles vectorielles servies par l'API depuis R2, dessinées par
// protomaps-leaflet). Tant qu'elle n'est pas en place, ou si NEXT_PUBLIC_MAP_TILES désigne un autre fond d'images,
// les tuiles d'OpenStreetMap.
import type { Map as LeafletMap } from "leaflet";

type Leaflet = typeof import("leaflet");

const OSM = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_TILES = process.env.NEXT_PUBLIC_MAP_TILES || OSM;
export const MAP_ATTRIBUTION = "© OpenStreetMap";
const OWN_ATTRIBUTION = '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · Protomaps';

type Info = { available: boolean; maxZoom?: number };
let info: Promise<Info> | null = null;
function ownMap(): Promise<Info> {
  info ??= fetch("/api/carte/info")
    .then((r) => (r.ok ? (r.json() as Promise<Info>) : { available: false }))
    .catch(() => ({ available: false }));
  return info;
}

// Pose le fond sous les autres couches de la carte.
export function addBaseLayer(L: Leaflet, map: LeafletMap) {
  const osm = () => L.tileLayer(MAP_TILES, { maxZoom: 19, attribution: MAP_ATTRIBUTION }).addTo(map);
  if (process.env.NEXT_PUBLIC_MAP_TILES) return void osm();
  ownMap()
    .then(async (i) => {
      if (!i.available) return osm();
      // protomaps-leaflet attend Leaflet en variable globale.
      (window as unknown as { L: Leaflet }).L = L;
      const { leafletLayer } = await import("protomaps-leaflet");
      // La carte a pu être fermée pendant le chargement.
      if (!map.getContainer().isConnected) return;
      leafletLayer({
        url: "/api/carte/{z}/{x}/{y}.mvt",
        flavor: "light",
        lang: "fr",
        maxDataZoom: i.maxZoom ?? 15,
        maxZoom: 19,
        attribution: OWN_ATTRIBUTION,
      } as Parameters<typeof leafletLayer>[0]).addTo(map);
    })
    .catch(() => osm());
}
