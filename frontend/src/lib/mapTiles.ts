// Fond de carte de toutes les cartes Zedeka (suivi, Zed à proximité, répartition, choix d'un point, navigation).
// Une seule adresse à changer pour passer sur notre propre fond (NEXT_PUBLIC_MAP_TILES, ex. tuiles servies depuis R2).
export const MAP_TILES = process.env.NEXT_PUBLIC_MAP_TILES || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const MAP_ATTRIBUTION = "© OpenStreetMap";
