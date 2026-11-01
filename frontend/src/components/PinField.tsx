"use client";

import { useState } from "react";

// Code PIN à 4 cases (clients et livreurs) : un seul champ invisible par-dessus, pour garder le clavier numérique et le collage.
export default function PinField({ name, label, hint, autoFocus }: { name: string; label: string; hint?: string; autoFocus?: boolean }) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <p className="mb-1.5 flex justify-between text-[13px] font-medium text-stone-600">
        <span>{label}</span>
        {hint && <span className="font-normal text-stone-500">{hint}</span>}
      </p>
      <div className="relative">
        <input
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          inputMode="numeric"
          autoComplete="off"
          pattern="\d{4}"
          required
          autoFocus={autoFocus}
          aria-label={label}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />
        <div className="grid grid-cols-4 gap-2.5" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`grid h-14 place-items-center rounded-xl border transition ${
                focused && i === Math.min(value.length, 3) ? "border-emerald-600/40 bg-white ring-4 ring-emerald-600/10" : "border-transparent bg-stone-100"
              }`}
            >
              {i < value.length && <span className="h-3 w-3 rounded-full bg-ink" />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
