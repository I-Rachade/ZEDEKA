"use client";

import { useState } from "react";
import { buttonGhost, ErrorNote, input } from "@/components/panel/ui";
import { Icon } from "@/components/panel/icons";
import { restaurantFetch } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { useRestaurantAction } from "../../useRestaurant";

const QUICK = [
  { kind: "READY_SOON", label: "Prête dans quelques minutes" },
  { kind: "READY", label: "Prête, venez la chercher" },
  { kind: "WAITING", label: "On vous attend au comptoir" },
] as const;

// Message rapide au livreur de la commande : il le reçoit en notification sur son téléphone.
export default function DriverMessage({ orderId }: { orderId: string }) {
  const action = useRestaurantAction();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const t = useT();

  const send = (body: { kind: string; text?: string }) =>
    action.run(async () => {
      setSent(null);
      const r = await restaurantFetch<{ sent: number }>(`/orders/${orderId}/driver-message`, { method: "POST", body });
      setSent(r.sent > 0 ? t("Message envoyé au livreur.") : t("Le livreur n'a pas activé les notifications : appelez-le."));
      setText("");
    });

  return (
    <div className="mt-3 border-t border-stone-100 pt-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
        <Icon name="bell" className="h-3.5 w-3.5" /> {t("Prévenir le livreur")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button key={q.kind} type="button" onClick={() => send({ kind: q.kind })} className={buttonGhost}>
            {t(q.label)}
          </button>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) send({ kind: "CUSTOM", text: text.trim() });
        }}
        className="mt-2 flex gap-2"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder={t("Autre message")} className={input} />
        <button className={buttonGhost} disabled={text.trim().length < 2}>
          {t("Envoyer")}
        </button>
      </form>
      {sent && <p className="mt-2 text-sm text-emerald-700">{sent}</p>}
      <ErrorNote message={action.error} />
    </div>
  );
}
