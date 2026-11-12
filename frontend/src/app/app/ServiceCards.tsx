"use client";

import Link from "next/link";
import { useServices, type ModuleCode } from "@/lib/services";
import { useT } from "@/lib/i18n/client";

// Les trois métiers de Zedeka à égalité : repas, colis, course Zed. En haut de l'accueil et de la feuille du bouton
// Services. Repas toujours là ; colis et course suivent la page Services de l'admin (ouvert : carte cliquable,
// « Bientôt » : grisée, caché : absente).
type Card = { key: string; module?: ModuleCode; href: string; emoji: string; image: string; title: string; hint: string; action: string; tone: string };

const CARDS: Card[] = [
  { key: "meal", href: "/app#repas", emoji: "🍽️", image: "/services/repas.webp", title: "Repas", hint: "Les restaurants de Lomé", action: "Commander", tone: "bg-emerald-50 text-emerald-800" },
  { key: "parcel", module: "PARCEL", href: "/colis", emoji: "📦", image: "/services/colis.webp", title: "Colis", hint: "Envoyer ou recevoir, partout à Lomé", action: "Envoyer", tone: "bg-sun-soft text-amber-900" },
  { key: "ride", module: "RIDE", href: "/app/zed", emoji: "🏍️", image: "/services/zed.webp", title: "Course Zed", hint: "Un Zed vient vous chercher", action: "Appeler", tone: "bg-ink-deep text-white" },
];

// Les modules repris par ces cartes : la feuille Services ne les répète pas dans ses autres listes.
export const TRIO_MODULES: ModuleCode[] = ["PARCEL", "RIDE"];

// Les trois cartes côte à côte (photo, nom, phrase, bouton). onPick : appelé au choix d'une carte (fermer la feuille) ;
// compact : feuille Services, un peu plus étroite.
export function ServiceTrio({ onPick, compact = false }: { onPick?: () => void; compact?: boolean }) {
  const t = useT();
  const services = useServices();
  const cards = CARDS.map((c) => ({ ...c, state: c.module ? services.modules.find((m) => m.code === c.module)?.state : "ON" })).filter((c) => c.state);
  const cols = cards.length === 3 ? "grid-cols-3" : cards.length === 2 ? "grid-cols-2" : "grid-cols-1";

  return (
    <ul className={`grid ${cols} gap-2.5`}>
      {cards.map((c) => {
        const on = c.state === "ON";
        const body = (
          <>
            <span className="relative block h-[104px] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- petite photo locale, déjà au bon format */}
              <img src={c.image} alt="" width={360} height={366} decoding="async" className={`h-full w-full object-cover ${on ? "" : "grayscale"}`} />
              <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-[10px] bg-surface text-[17px] shadow-sm" aria-hidden="true">
                {c.emoji}
              </span>
            </span>
            <span className="flex flex-1 flex-col px-2.5 pb-3 pt-2">
              <span className={`${compact ? "text-[15px]" : "text-[16px]"} whitespace-nowrap font-bold leading-tight`}>{t(c.title)}</span>
              <span className="mt-0.5 flex-1 text-[12px] leading-snug text-stone-500">{t(c.hint)}</span>
              <span className={`mt-2 self-start rounded-full px-2.5 py-1.5 text-[12.5px] font-bold ${on ? c.tone : "bg-stone-100 text-stone-500"}`}>{on ? t(c.action) : t("Bientôt")}</span>
            </span>
          </>
        );
        const cls = "card-gloss flex h-full flex-col overflow-hidden rounded-[18px]";
        return (
          <li key={c.key}>
            {on ? (
              <Link href={c.href} onClick={onPick} className={`${cls} transition active:scale-[0.97]`}>
                {body}
              </Link>
            ) : (
              <div aria-disabled="true" className={`${cls} opacity-70`}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Accueil : titre, les trois cartes et des raccourcis.
export default function ServiceCards() {
  const t = useT();
  const services = useServices();
  const ride = services.modules.some((m) => m.code === "RIDE" && m.state === "ON");

  return (
    <section className="space-y-3 px-4" aria-labelledby="services-title">
      <h2 id="services-title" className="text-[20px] font-bold leading-tight">
        {t("Que voulez-vous faire ?")}
      </h2>
      <ServiceTrio />
      <div className="-mx-4 flex snap-x scroll-px-4 gap-2 overflow-x-auto px-4 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-noswipe>
        <Shortcut href="/suivi" emoji="📍" label={t("Suivre un colis")} />
        {ride && <Shortcut href="/app/zed" emoji="🕒" label={t("Réserver un Zed")} />}
        <Shortcut href="/app/aide" emoji="💬" label={t("Aide et contact")} />
      </div>
    </section>
  );
}

function Shortcut({ href, emoji, label }: { href: string; emoji: string; label: string }) {
  return (
    <Link href={href} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 px-3.5 text-[14px] font-semibold text-ink transition active:scale-[0.97]">
      <span aria-hidden="true">{emoji}</span>
      {label}
    </Link>
  );
}
