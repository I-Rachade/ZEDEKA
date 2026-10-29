"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { dateLocale, LANG_COOKIE, tFor, type Lang, type T } from ".";

type Ctx = { lang: Lang; setLang: (lang: Lang) => void; t: T; locale: string };

const I18n = createContext<Ctx>({ lang: "fr", setLang: () => {}, t: tFor("fr"), locale: dateLocale("fr") });

// La langue vient du cookie, lu par la mise en page racine : la page arrive déjà dans la bonne langue.
export function I18nProvider({ lang: initial, children }: { lang: Lang; children: React.ReactNode }) {
  const [lang, setState] = useState<Lang>(initial);
  const router = useRouter();
  const setLang = useCallback(
    (next: Lang) => {
      // Un an, pour tout le site : l'API lit aussi ce cookie pour ses messages.
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      document.documentElement.lang = next;
      setState(next);
      // Pages rendues côté serveur : à refaire dans la nouvelle langue.
      router.refresh();
    },
    [router],
  );
  const value = useMemo(() => ({ lang, setLang, t: tFor(lang), locale: dateLocale(lang) }), [lang, setLang]);
  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);
export const useT = () => useContext(I18n).t;

// Sélecteur FR / EN, visible dans chaque en-tête.
export function LanguageSwitch({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  const { lang, setLang } = useI18n();
  const base = dark ? "border-white/20 bg-white/10" : "border-stone-200 bg-white";
  const on = dark ? "bg-white text-stone-900" : "bg-emerald-600 text-white";
  const off = dark ? "text-white/70" : "text-stone-500";
  return (
    <span role="group" aria-label={lang === "en" ? "Language" : "Langue"} className={`inline-flex shrink-0 rounded-full border p-0.5 text-xs font-semibold ${base} ${className}`}>
      {(["fr", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          title={l === "fr" ? "Français" : "English"}
          onClick={() => lang !== l && setLang(l)}
          className={`rounded-full px-2 py-0.5 uppercase ${lang === l ? on : off}`}
        >
          {l}
        </button>
      ))}
    </span>
  );
}
