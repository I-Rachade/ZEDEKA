"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";
import { useAds, type HomeAd } from "./data";

// Bannière publicitaire de l'accueil : les publicités de l'admin défilent toutes les 5 s (glisser du doigt
// pour passer à la suivante). L'emplacement garde toujours la même taille (16:7), même pendant le chargement,
// pour que l'écran ne saute pas. Sans publicité, une bannière Zedeka occupe la place.

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
function HouseBanner() {
  const t = useT();
  return (
    <div className={`${frame} sheen gloss flex items-center bg-gradient-to-br from-amber-300 via-amber-400 to-orange-500 p-5 text-ink`}>
      <div className="relative z-10 max-w-[68%] space-y-1">
        <p className="font-display text-[24px] font-extrabold uppercase leading-[1.05] text-emerald-900">{t("Livré partout à Lomé")}</p>
        <p className="text-[14px] font-medium text-ink/80">{t("Repas, colis et courses Zed")}</p>
      </div>
      <span className="absolute -bottom-1 right-3 text-[76px] leading-none drop-shadow-sm" aria-hidden="true">
        🛵
      </span>
    </div>
  );
}

export default function AdCarousel({ light = false }: { light?: boolean }) {
  const { data: ads } = useAds();
  const track = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const t = useT();
  const count = ads?.length ?? 0;

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
  if (count === 0) return <HouseBanner />;

  return (
    <section aria-roledescription="carousel" aria-label={t("Publicités")} className="space-y-2">
      <div
        ref={track}
        onScroll={onScroll}
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerCancel={() => setPaused(false)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        className={`${frame} flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory overflow-x-auto bg-stone-200`}
      >
        {ads.map((ad, i) => (
          <Slide key={ad.id} ad={ad} index={i} total={count} />
        ))}
      </div>
      {count > 1 && (
        <div className="flex justify-center gap-2">
          {ads.map((ad, i) => (
            <button
              key={ad.id}
              type="button"
              onClick={() => go(i)}
              aria-label={t("Voir la publicité {n}", { n: i + 1 })}
              aria-current={i === current}
              className={`h-1.5 rounded-full transition-all ${i === current ? `w-5 ${light ? "bg-emerald-700" : "bg-surface"}` : `w-1.5 ${light ? "bg-stone-300" : "bg-white/50"}`}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
