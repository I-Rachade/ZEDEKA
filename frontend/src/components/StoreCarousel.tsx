"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n/client";

// Carrousel de bannières en haut de la page d'une boutique : images et vidéos publicitaires du marchand.
// Les images défilent toutes les 5 s ; une vidéo se lit en entier (sans le son, en boucle si elle est seule)
// avant de passer à la suite. Glisser du doigt change de bannière. Même format que la bannière de l'accueil (16:7).

export type CarouselBanner = { id: string; kind: "IMAGE" | "VIDEO"; url: string; posterUrl: string | null; title: string; productId?: string | null };

const EVERY_MS = 5000;

export default function StoreCarousel({ banners, onOpen }: { banners: CarouselBanner[]; onOpen?: (b: CarouselBanner) => void }) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const total = banners.length;
  const current = banners[index];

  // Passe à la bannière suivante : minuterie pour une image, fin de lecture pour une vidéo.
  useEffect(() => {
    if (total < 2 || current?.kind === "VIDEO") return;
    const id = setTimeout(() => go((index + 1) % total), EVERY_MS);
    return () => clearTimeout(id);
  }, [index, total, current?.kind]);

  // La vidéo visible joue, les autres sont en pause.
  useEffect(() => {
    track.current?.querySelectorAll("video").forEach((v, i) => {
      if (i === index) void v.play().catch(() => {});
      else v.pause();
    });
  }, [index]);

  function go(i: number) {
    const el = track.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setIndex(i);
  }

  if (!total) return null;
  return (
    <div className="relative">
      <div
        ref={track}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== index) setIndex(i);
        }}
        className="flex aspect-[16/7] w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-[12px] bg-stone-200 [scrollbar-width:none]"
        aria-roledescription="carousel"
        aria-label={t("Publicités de la boutique")}
      >
        {banners.map((b, i) => {
          const label = t("Publicité {n} sur {total}", { n: i + 1, total });
          const media =
            b.kind === "VIDEO" ? (
              <video
                src={b.url}
                poster={b.posterUrl ?? undefined}
                muted
                playsInline
                autoPlay={i === 0}
                loop={total === 1}
                preload={i === 0 ? "auto" : "metadata"}
                onEnded={() => total > 1 && go((i + 1) % total)}
                className="h-full w-full object-cover"
                aria-label={b.title || label}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- image envoyée par le marchand
              <img src={b.url} alt={b.title || label} loading={i === 0 ? "eager" : "lazy"} draggable={false} className="h-full w-full object-cover" />
            );
          const cls = "relative block h-full w-full shrink-0 snap-center";
          return onOpen && b.productId ? (
            <button key={b.id} type="button" onClick={() => onOpen(b)} className={cls} aria-label={`${b.title || t("Voir le produit")} · ${label}`}>
              {media}
              {b.title && <Caption text={b.title} />}
            </button>
          ) : (
            <div key={b.id} role="group" aria-roledescription="slide" aria-label={label} className={cls}>
              {media}
              {b.title && <Caption text={b.title} />}
            </div>
          );
        })}
      </div>
      {total > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
          {banners.map((b, i) => (
            <span key={b.id} className={`keep-round h-1.5 rounded-full transition-all ${i === index ? "w-4 bg-white" : "w-1.5 bg-white/60"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Caption({ text }: { text: string }) {
  return (
    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pb-5 pt-6 text-left text-[15px] font-semibold text-white">{text}</span>
  );
}
