"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiGet } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { useAds, type HomeAd } from "./data";

// Bannière publicitaire de l'accueil : les publicités de l'admin défilent toutes les 5 s (glisser du doigt
// pour passer à la suivante). L'emplacement garde toujours la même taille (16:7), même pendant le chargement,
// pour que l'écran ne saute pas. Sans publicité, une bannière Zedeka occupe la place. Suivent toujours trois
// publicités maison pour les professionnels (marchands, restaurants, livreurs et Zed).

const EVERY_MS = 5000;
const frame = "relative aspect-[16/7] w-full overflow-hidden rounded-[12px]";

function Slide({ ad, index, total }: { ad: HomeAd; index: number; total: number }) {
  const t = useT();
  // eslint-disable-next-line @next/next/no-img-element -- image envoyée dans l'admin (R2 ou lien externe)
  const img = <img src={ad.imageUrl} alt={ad.title} loading={index === 0 ? "eager" : "lazy"} fetchPriority={index === 0 ? "high" : "low"} draggable={false} className="h-full w-full object-cover" />;
  const label = t("Publicité {n} sur {total}", { n: index + 1, total });
  const cls = "block h-full w-full shrink-0 snap-center";
  if (!ad.linkUrl) return <div role="group" aria-roledescription="slide" aria-label={label} className={cls}>{img}</div>;
  return ad.linkUrl.startsWith("/") ? (
    <Link href={ad.linkUrl} aria-label={`${ad.title} · ${label}`} className={cls}>
      {img}
    </Link>
  ) : (
    <a href={ad.linkUrl} target="_blank" rel="noopener sponsored" aria-label={`${ad.title} · ${label}`} className={cls}>
      {img}
    </a>
  );
}

// Place réservée quand aucune publicité n'est en ligne.
function HouseBanner({ slide = false }: { slide?: boolean }) {
  const t = useT();
  // Même visuel que la publicité « Livré partout à Lomé » (public/pubs), texte intégré à l'image.
  return (
    <div className={slide ? "h-full w-full shrink-0 snap-center bg-amber-500" : `${frame} bg-amber-500`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- fichier statique déjà à la bonne taille (WebP 1440×630) */}
      <img src="/pubs/zedeka-lome.webp" alt={`${t("Livré partout à Lomé")} · ${t("Repas, colis et courses Zed")}`} fetchPriority="high" draggable={false} className="h-full w-full object-cover" />
    </div>
  );
}

// Publicités maison pour les professionnels, après celles de l'admin : marchands, restaurants, livreurs et Zed.
// Restaurants : message WhatsApp à Zedeka (numéro des réglages), sinon les conditions partenaires.
let whatsappCache: Promise<string | null> | null = null;
function useWhatsapp() {
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (whatsappCache ??= apiGet<{ whatsapp?: string }>("/api/policies")
      .then((p) => p?.whatsapp?.replace(/\D/g, "") || null)
      .catch(() => null)).then((w) => live && setPhone(w));
    return () => {
      live = false;
    };
  }, []);
  return phone;
}

type Pro = { key: string; emoji: string; kicker: string; title: string; text: string; action: string; href: string; tone: string; accent: string; external?: boolean };

function ProSlide({ pro, label }: { pro: Pro; label: string }) {
  const t = useT();
  const body = (
    <span className={`flex h-full w-full items-center gap-3 px-4 ${pro.tone}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-wide opacity-80">{t(pro.kicker)}</span>
        <span className="mt-0.5 block text-[18px] font-extrabold leading-tight">{t(pro.title)}</span>
        <span className="mt-1 line-clamp-2 block text-[12.5px] leading-snug opacity-90">{t(pro.text)}</span>
        <span className={`mt-2 inline-block text-[13px] font-bold ${pro.accent}`}>{t(pro.action)} →</span>
      </span>
      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white/25 text-[34px]" aria-hidden="true">
        {pro.emoji}
      </span>
    </span>
  );
  const cls = "block h-full w-full shrink-0 snap-center";
  return pro.external ? (
    <a href={pro.href} target="_blank" rel="noopener noreferrer" aria-label={`${t(pro.title)} · ${label}`} className={cls}>
      {body}
    </a>
  ) : (
    <Link href={pro.href} aria-label={`${t(pro.title)} · ${label}`} className={cls}>
      {body}
    </Link>
  );
}

function usePros(): Pro[] {
  const t = useT();
  const whatsapp = useWhatsapp();
  return [
    {
      key: "merchant",
      emoji: "🛍️",
      kicker: "Vous êtes marchand ?",
      title: "Vos colis livrés et encaissés",
      text: "Envoyez vos colis en lot. Le livreur encaisse chez votre client et Zedeka vous reverse.",
      action: "Ouvrir ma boutique",
      href: "/marchand",
      tone: "bg-sun-soft text-amber-950",
      accent: "text-amber-800",
    },
    {
      key: "restaurant",
      emoji: "👨‍🍳",
      kicker: "Vous êtes restaurant ?",
      title: "Vendez vos plats sur Zedeka",
      text: "Nos livreurs s'occupent du reste. Caisse et commandes à table incluses.",
      action: "Devenir partenaire",
      href: whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(t("Bonjour, mon restaurant souhaite rejoindre Zedeka."))}` : "/conditions-partenaires",
      external: Boolean(whatsapp),
      tone: "bg-emerald-700 text-white",
      accent: "text-sun",
    },
    {
      key: "driver",
      emoji: "🏍️",
      kicker: "Vous avez une moto ?",
      title: "Devenez livreur ou Zed",
      text: "Livrez repas et colis, ou transportez des clients, aux heures qui vous arrangent.",
      action: "Postuler",
      href: "/livreur/candidature",
      tone: "bg-ink-deep text-white",
      accent: "text-sun",
    },
  ];
}

export default function AdCarousel({ light = false }: { light?: boolean }) {
  const { data: ads } = useAds();
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const t = useT();
  const pros = usePros();
  // Publicités de l'admin (ou la bannière maison s'il n'y en a pas), puis les trois publicités pour les pros.
  const slides: { key: string; node: (index: number, total: number) => ReactNode }[] = [
    ...(ads && ads.length > 0
      ? ads.map((ad) => ({ key: ad.id, node: (i: number, n: number) => <Slide key={ad.id} ad={ad} index={i} total={n} /> }))
      : [{ key: "house", node: () => <HouseBanner key="house" slide /> }]),
    ...pros.map((p) => ({ key: p.key, node: (i: number, n: number) => <ProSlide key={p.key} pro={p} label={t("Publicité {n} sur {total}", { n: i + 1, total: n })} /> })),
  ];
  const count = ads ? slides.length : 0;

  // Suit la publicité visible quand le client fait glisser.
  const onScroll = () => {
    const el = track.current;
    if (el && el.clientWidth) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  };

  const go = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };

  // light : points sous la bannière sur fond blanc (accueil), sinon sur l'en-tête vert.
  // Défilement automatique, arrêté pendant que le doigt est posé, hors écran, ou si l'appareil demande moins d'animations.
  useEffect(() => {
    if (count < 2 || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") go((current + 1) % count);
    }, EVERY_MS);
    return () => clearInterval(timer);
  }, [count, current, paused]);

  if (!ads) return <div className={`${frame} skeleton`} aria-hidden="true" />;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("Publicités")}
      // Pause pendant que le doigt ou la souris est sur la bannière ou sur ses points.
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerCancel={() => setPaused(false)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="space-y-1"
    >
      <div
        ref={track}
        onScroll={onScroll}
        className={`${frame} flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory overflow-x-auto bg-stone-200`}
      >
        {slides.map((s, i) => s.node(i, count))}
      </div>
      {count > 1 && (
        <div className="flex justify-center">
          {/* Chaque point a une zone de toucher fixe (24 px) : seul le trait dessiné s'allonge, rien ne bouge autour. */}
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              aria-label={t("Voir la publicité {n}", { n: i + 1 })}
              aria-current={i === current}
              className="grid h-6 w-6 place-items-center"
            >
              <span className={`block h-1.5 rounded-full transition-all ${i === current ? `w-5 ${light ? "bg-emerald-700" : "bg-surface"}` : `w-1.5 ${light ? "bg-stone-300" : "bg-white/50"}`}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
