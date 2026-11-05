"use client";

import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { ZED_DOCUMENTS, type ZedDocumentKind } from "@/lib/driver";
import { photoDataUrl } from "@/lib/photo";
import { useT } from "@/lib/i18n/client";

export type Photos = Partial<Record<ZedDocumentKind, string>>;
export const photosReady = (p: Photos) => ZED_DOCUMENTS.every((d) => !d.required || p[d.kind]);

// Photos du dossier Zed : appareil photo du téléphone ou galerie, aperçu, réduites avant l'envoi.
export function ZedPhotos({ value, onChange }: { value: Photos; onChange: (p: Photos) => void }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-stone-600">{t("Photos du dossier")}</p>
      <ul className="grid grid-cols-2 gap-2">
        {ZED_DOCUMENTS.map((d) => {
          const src = value[d.kind];
          return (
            <li key={d.kind}>
              <label
                className={`relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border-2 border-dashed p-2 text-center text-xs ${src ? "border-emerald-600" : "border-stone-300 bg-white"}`}
              >
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <Icon name="plus" className="h-6 w-6 text-stone-400" />
                )}
                <span className={`relative rounded-full px-2 py-0.5 font-medium ${src ? "bg-emerald-600 text-white" : "text-stone-600"}`}>
                  {src && "✓ "}
                  {t(d.label)}
                  {!d.required && !src && ` (${t("facultatif")})`}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture={d.kind === "SELFIE" ? "user" : "environment"}
                  className="sr-only"
                  aria-label={t(d.label)}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setError(null);
                      onChange({
                        ...value,
                        [d.kind]: await photoDataUrl(file),
                      });
                    } catch {
                      setError(t("Photo illisible, réessayez."));
                    }
                  }}
                />
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-stone-500">{t("Vos pièces ne sont vues que par l'équipe Zedeka, pour vérifier votre identité.")}</p>
    </div>
  );
}
