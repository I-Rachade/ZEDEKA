// Mode caisse retenu sur cet appareil : l'espace restaurant s'y ouvre directement tant qu'il est choisi.
const KEY = "zedeka-restaurant-pos";

export function isPosMode() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setPosMode(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // stockage indisponible : le mode caisse s'ouvre depuis le menu
  }
}
