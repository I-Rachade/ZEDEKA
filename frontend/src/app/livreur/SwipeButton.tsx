"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/panel/icons";

// Bouton à glisser jusqu'au bout pour valider une étape (évite les validations par erreur dans la poche).
// Au clavier : Entrée ou Espace valident.
export default function SwipeButton({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const KNOB = 56;

  const max = () => (track.current?.clientWidth ?? 300) - KNOB - 8;

  function end() {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (dx >= max() * 0.85) onConfirm();
    setDx(0);
  }

  return (
    <div
      ref={track}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onConfirm();
        }
      }}
      className={`relative h-16 select-none overflow-hidden rounded-2xl ${disabled ? "bg-stone-300" : "bg-emerald-700"} touch-none`}
    >
      <div className="absolute inset-y-0 left-0 rounded-2xl bg-emerald-500/60" style={{ width: dx + KNOB + 8 }} />
      <p className="absolute inset-0 grid place-items-center pl-12 font-semibold text-white">{label}</p>
      <div
        data-knob
        onPointerDown={(e) => {
          if (disabled) return;
          start.current = e.clientX - dx;
          setDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          setDx(Math.max(0, Math.min(max(), e.clientX - start.current)));
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setDx(0);
        }}
        className="absolute left-1 top-1 grid h-14 w-14 cursor-grab place-items-center rounded-xl bg-white text-emerald-700 shadow"
        style={{ transform: `translateX(${dx}px)`, transition: dragging ? "none" : "transform 0.2s" }}
      >
        <Icon name="chevron" className="h-6 w-6" />
      </div>
    </div>
  );
}
