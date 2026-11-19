"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { apiGet } from "@/lib/api";
import { trackHref } from "@/lib/device";
import { useT } from "@/lib/i18n/client";

// Même mise en forme que le serveur : « zd zvke 7cdx » devient « ZD-ZVKE-7CDX ».
export function normalizeCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = /^(Z[A-Z])([A-Z0-9]{4})([A-Z0-9]{4})?$/.exec(raw);
  if (!m) return input.toUpperCase().replace(/\s/g, "");
  return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
}

// Suivre une livraison avec son code (reçu par WhatsApp, SMS ou de vive voix), même passée par quelqu'un d'autre.
// La page de suivi s'ouvre comme un lien partagé : avancement et trajet, sans les coordonnées de personne.
export default function CodeTrack() {
  const t = useT();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code.trim());
    if (c.replace(/-/g, "").length < 6) {
      setError(t("Tapez le code complet, par exemple ZD-ZVKE-7CDX."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await apiGet<{ code: string }>(`/api/orders/${encodeURIComponent(c)}`);
      if (!found) throw new Error(t("Aucune livraison ne correspond à ce code."));
      router.push(trackHref(found.code));
    } catch (err) {
      setError((err as Error).message.startsWith("API ") ? t("Recherche impossible pour le moment, réessayez.") : (err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-4 mt-2 rounded-[12px] bg-surface p-3 shadow-sm">
      <label htmlFor="track-code" className="block px-1 pb-2 text-[13px] font-semibold text-stone-600">
        {t("Suivre une livraison avec son code")}
      </label>
      <div className="flex gap-2">
        <span className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
          <input
            id="track-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="ZD-ZVKE-7CDX"
            className="w-full rounded-xl border border-transparent bg-stone-100 py-3 pl-9 pr-3 font-mono uppercase tracking-wide outline-none transition placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-stone-400 focus:border-emerald-600/40 focus:bg-surface focus:ring-4 focus:ring-emerald-600/10"
          />
        </span>
        <button disabled={busy || !code.trim()} className="shrink-0 rounded-xl bg-emerald-600 px-4 font-semibold text-white disabled:opacity-50">
          {busy ? t("Un instant…") : t("Suivre")}
        </button>
      </div>
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </form>
  );
}
