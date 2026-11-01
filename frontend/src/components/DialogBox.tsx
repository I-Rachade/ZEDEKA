"use client";

import { useEffect, useRef } from "react";

// Fenêtres (fiche d'un plat, panier, carte, choix d'adresse) au clavier : le focus entre dans la fenêtre à
// l'ouverture, Tab tourne à l'intérieur sans repartir dans la page derrière, Échap ferme (si `onClose` est
// donné), et le focus revient sur le bouton qui l'avait ouverte.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus<T extends HTMLElement>(onClose?: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    if (!box.hasAttribute("tabindex")) box.tabIndex = -1;
    (items()[0] ?? box).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && close.current) {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = items();
      if (list.length === 0) return e.preventDefault();
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    box.addEventListener("keydown", onKey);
    return () => {
      box.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return ref;
}

// Boîte de dialogue prête à l'emploi : un <div role="dialog" aria-modal> avec le comportement clavier ci-dessus.
export function DialogBox({ onClose, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { onClose?: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" {...props}>
      {children}
    </div>
  );
}
