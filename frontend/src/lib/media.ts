// Photos des plats rangées par Zedeka (R2, servies par /api/media/menu-images/...) : une vignette légère
// (480 px, ~30 ko au lieu de ~200 ko) est envoyée avec chaque nouvelle photo. Les listes l'affichent ; l'API
// renvoie la photo entière quand la vignette n'existe pas (photos envoyées avant, ou liens collés à la main).
const OWN_PHOTO = /\/api\/media\/menu-images\/[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export const THUMB_SIDE = 480;

export function thumbOf(url: string): string {
  return OWN_PHOTO.test(url) ? `${url}?size=thumb` : url;
}

// Nom du fichier d'une photo Zedeka (pour envoyer sa vignette), ou null pour un lien externe.
export function photoName(url: string): string | null {
  return OWN_PHOTO.test(url) ? url.slice(url.lastIndexOf("/") + 1) : null;
}
