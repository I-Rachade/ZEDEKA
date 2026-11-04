"use client";

import { useEffect, useRef } from "react";

// Glisser du doigt vers la gauche ou la droite sur toute la page (volets Repas/Colis/Courses, Colis/Course).
// Ignoré quand le geste part d'un champ, d'une carte ou d'une zone qui défile déjà à l'horizontale
// (attribut data-noswipe), et quand le doigt monte ou descend plus qu'il ne va de côté.
export function useSwipe(handlers: { onLeft?: () => void; onRight?: () => void }, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number; t: number } | null = null;
    const down = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.touches.length !== 1 || target?.closest("input, textarea, select, [data-noswipe], .leaflet-container")) {
        start = null;
        return;
      }
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    };
    const up = (e: TouchEvent) => {
      if (!start) return;
      const dx = e.changedTouches[0].clientX - start.x;
      const dy = e.changedTouches[0].clientY - start.y;
      const quick = Date.now() - start.t < 700;
      start = null;
      if (!quick || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8) return;
      if (dx < 0) ref.current.onLeft?.();
      else ref.current.onRight?.();
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchend", up);
    };
  }, [enabled]);
}
