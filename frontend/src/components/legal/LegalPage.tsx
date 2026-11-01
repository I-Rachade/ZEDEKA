import type { Metadata } from "next";
import InfoPage from "@/app/app/InfoPage";
import { getLang, getT } from "@/lib/i18n/server";
import { LEGAL_UPDATED } from "@/lib/legal";

// Mise en page des textes légaux : sur le site public (titre et carte blanche) ou dans l'application client
// (barre du haut avec « Retour » vers le profil). Les textes sont en français, langue officielle du Togo :
// en anglais, une note le dit en tête de page.
export const legalProse =
  "space-y-4 text-[15px] leading-relaxed text-stone-800 [&_:is(p,li)_a]:text-emerald-800 [&_:is(p,li)_a]:underline [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-stone-900 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5";

export const legalMetadata = (title: string) =>
  async function generateMetadata(): Promise<Metadata> {
    const t = await getT();
    return { title: `${t(title)} – Zedeka` };
  };

export default async function LegalPage({ title, app = false, frenchOnly = true, children }: { title: string; app?: boolean; frenchOnly?: boolean; children: React.ReactNode }) {
  const lang = await getLang();
  const t = await getT();
  const body = (
    <>
      <p className="text-sm text-stone-600">{t("Version du {date}", { date: LEGAL_UPDATED })}</p>
      {frenchOnly && lang === "en" && (
        <p lang="en" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {t("Ce texte est rédigé en français, langue officielle du Togo ; seule la version française fait foi. Écrivez-nous pour toute question.")}
        </p>
      )}
      <div lang={frenchOnly ? "fr" : undefined} className="space-y-4">
        {children}
      </div>
    </>
  );
  if (app) return <InfoPage title={title}>{body}</InfoPage>;
  return (
    <article className={`${legalProse} rounded-[20px] bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]`}>
      <h1 className="text-2xl font-bold text-stone-900">{t(title)}</h1>
      {body}
    </article>
  );
}
