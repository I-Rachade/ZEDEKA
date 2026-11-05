"use client";

import { createRoot } from "react-dom/client";
import { useDialogFocus } from "./DialogBox";

// Alerte à la manière d'Apple, à la place de window.confirm (« OK / Annuler » du navigateur) : un message court,
// deux boutons côte à côte, « Annuler » à gauche, l'action à droite nommée par son verbe (« Supprimer »,
// « Se déconnecter »…), en rouge quand elle détruit quelque chose. Échap ou un toucher à côté annule.
//   if (!(await askConfirm(t("Supprimer la table 3 ?"), t("Supprimer"), { destructive: true }))) return;
type Options = { destructive?: boolean; cancelLabel?: string };

export function askConfirm(message: string, action: string, options: Options = {}): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };
    const cancelLabel = options.cancelLabel ?? (document.documentElement.lang === "en" ? "Cancel" : "Annuler");
    root.render(<Alert message={message} action={action} cancelLabel={cancelLabel} destructive={!!options.destructive} onDone={done} />);
  });
}

function Alert({ message, action, cancelLabel, destructive, onDone }: { message: string; action: string; cancelLabel: string; destructive: boolean; onDone: (ok: boolean) => void }) {
  const ref = useDialogFocus<HTMLDivElement>(() => onDone(false));
  return (
    <div className="anim-fade-up fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" onClick={() => onDone(false)}>
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
        onClick={(e) => e.stopPropagation()}
        className="w-[270px] max-w-full overflow-hidden rounded-[14px] bg-surface text-center shadow-xl"
      >
        <p className="px-4 pb-4 pt-5 text-[15px] leading-snug text-stone-900">{message}</p>
        <div className="hairline-t grid grid-cols-2">
          <button type="button" onClick={() => onDone(false)} className="min-h-11 px-2 py-3 text-[17px] text-emerald-700">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onDone(true)}
            className={`min-h-11 border-l border-stone-200 px-2 py-3 text-[17px] font-semibold ${destructive ? "text-red-600" : "text-emerald-700"}`}
          >
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
