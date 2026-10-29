"use client";

import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { useHydrated } from "@/lib/device";

// Code de commande en grand, à copier ou à envoyer sur WhatsApp sans le recopier à la main.
export default function OrderCode({ code, tone = "dark" }: { code: string; tone?: "dark" | "light" }) {
  const [copied, setCopied] = useState(false);
  const hydrated = useHydrated();
  const light = tone === "light";
  const button = `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${light ? "bg-white/15 text-white" : "bg-emerald-600/10 text-emerald-700"}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // presse-papiers refusé : le code reste sélectionnable à l'écran
    }
  }

  const link = !hydrated ? "" : `${window.location.origin}/commande/${code}`;
  const share = `https://wa.me/?text=${encodeURIComponent(`Suivi de ma commande Zedeka ${code} : ${link}`)}`;

  return (
    <div className="space-y-2">
      <p className="select-all font-mono text-xl font-semibold tracking-wider">{code}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={button}>
          <Icon name={copied ? "check" : "doc"} className="h-4 w-4" />
          {copied ? "Copié" : "Copier"}
        </button>
        <a href={share} target="_blank" rel="noopener noreferrer" className={button}>
          <Icon name="phone" className="h-4 w-4" />
          Partager sur WhatsApp
        </a>
      </div>
    </div>
  );
}
