"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { useT } from "@/lib/i18n/client";
import { useAds, type HomeAd } from "./data";

// Bannière publicitaire de l'accueil : les publicités de l'admin défilent toutes les 5 s (glisser du doigt
// pour passer à la suivante). L'emplacement garde toujours la même taille (16:7), même pendant le chargement,
// pour que l'écran ne saute pas. Sans publicité, une bannière Zedeka occupe la place.

const EVERY_MS = 5000;
const frame = "relative aspect-[16/7] w-full overflow-hidden rounded-[20px]";

function Slide({ ad, index, total }: { ad: HomeAd; index: number; total: number }) {
  const t = useT();
  // eslint-disable-next-line @next/next/no-img-element -- image envoyée dans l'admin (R2 ou lien externe)
  const img = <img src={ad.imageUrl} alt={ad.title} loading={index === 0 ? "eager" : "lazy"} draggable={false} className="h-full w-full object-cover" />;
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
    <div className={`${frame} flex items-center bg-gradient-to-br from-emerald-700 to-ink p-5 text-white`}>
      <div className="relative z-10 max-w-[70%] space-y-1">
        <p className="text-[12px] font-semibold uppercase tracking-wide text-sun">{t("Zedeka à Lomé")}</p>
        <p className="text-[19px] font-bold leading-tight">{t("Vos repas et vos colis, livrés dans toute la ville")}</p>
      </div>
      <LogoMark className="absolute -bottom-5 -right-5 h-32 w-32 rotate-[-8deg] opacity-90" />
    </div>
  );
}

export default function AdCarousel() {
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
        <div className="flex justify-center gap-1.5">
          {ads.map((ad, i) => (
            <button
              key={ad.id}
              type="button"
              onClick={() => go(i)}
              aria-label={t("Voir la publicité {n}", { n: i + 1 })}
              aria-current={i === current}
              className={`h-1.5 rounded-full transition-all ${i === current ? "w-5 bg-emerald-600" : "w-1.5 bg-stone-300"}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
