import { EN } from "./en";

// Deux langues : le français (par défaut, Togo) et l'anglais. Le texte français sert de clé : t("Ajouter")
// renvoie « Add » en anglais. Une phrase absente du dictionnaire reste en français (voir scripts/check-i18n.mjs).

export type Lang = "fr" | "en";
export const LANGS: Lang[] = ["fr", "en"];
export const LANG_COOKIE = "lang";

export type Vars = Record<string, string | number>;
export type T = (fr: string, vars?: Vars) => string;

export const isLang = (v: unknown): v is Lang => v === "fr" || v === "en";

export function translate(lang: Lang, fr: string, vars?: Vars): string {
  const text = lang === "en" ? (EN[fr] ?? fr) : fr;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}

export const tFor = (lang: Lang): T => (fr, vars) => translate(lang, fr, vars);

// Dates et heures : format de la langue choisie.
export const dateLocale = (lang: Lang) => (lang === "en" ? "en-GB" : "fr-FR");

// Langue de la page en cours, pour les messages produits hors des composants (bibliothèques, gestionnaires).
export function currentLang(): Lang {
  if (typeof document === "undefined") return "fr";
  return document.documentElement.lang === "en" ? "en" : "fr";
}

export const tr: T = (fr, vars) => translate(currentLang(), fr, vars);
