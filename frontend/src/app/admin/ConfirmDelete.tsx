"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { DialogBox } from "@/components/DialogBox";
import { useT } from "@/lib/i18n/client";
import { buttonDanger, buttonGhost, ErrorNote, input } from "./ui";

// Suppression définitive : la fenêtre demande de taper le mot « supprimer » (« delete » en anglais) avant
// d'activer le bouton, pour qu'un clic distrait n'efface rien.
export function ConfirmDelete({
  title,
  children,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  error?: string | null;
  onConfirm: () => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useT();
  const word = t("supprimer");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toLowerCase() === word.toLowerCase() && !busy;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : onClose}>
      <DialogBox
        onClose={busy ? undefined : onClose}
        aria-labelledby="confirm-delete-title"
        className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-delete-title" className="text-lg font-semibold text-red-700">
          {title}
        </h2>
        <div className="space-y-2 text-sm text-stone-700">{children}</div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!ready) return;
            setBusy(true);
            const ok = await onConfirm();
            setBusy(false);
            if (ok) onClose();
          }}
          className="space-y-3"
        >
          <label className="block text-sm">
            <span className="mb-1 block text-stone-600">{t("Pour confirmer, tapez « {word} » ci-dessous.", { word })}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={word}
              className={`${input} w-full`}
            />
          </label>
          <ErrorNote message={error} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={buttonGhost}>
              {t("Annuler")}
            </button>
            <button disabled={!ready} className={`${buttonDanger} disabled:cursor-not-allowed disabled:opacity-50`}>
              {busy ? t("Suppression…") : t("Supprimer définitivement")}
            </button>
          </div>
        </form>
      </DialogBox>
    </div>,
    document.body,
  );
}
