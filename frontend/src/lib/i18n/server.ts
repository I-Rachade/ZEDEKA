import { cookies } from "next/headers";
import { isLang, LANG_COOKIE, tFor, type Lang } from ".";

// Langue choisie (cookie), pour les pages rendues côté serveur.
export async function getLang(): Promise<Lang> {
  const value = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(value) ? value : "fr";
}

export async function getT() {
  return tFor(await getLang());
}
