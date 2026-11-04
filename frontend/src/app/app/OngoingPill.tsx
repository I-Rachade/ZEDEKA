"use client";

import Link from "next/link";
import { Icon } from "@/components/panel/icons";
import { trackHref } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { useHistory } from "./data";
import { KIND } from "./ui";

// Phrase et avancement (sur 5) de chaque étape, comme la barre nommée du suivi.
const STEP: Record<string, [string, number]> = {
  PENDING: ["Commande reçue", 0],
  CONFIRMED: ["Acceptée", 1],
  PREPARING: ["En cuisine", 1],
  READY: ["Prête, un livreur arrive", 2],
  PICKED_UP: ["En route vers vous", 3],
};

// Pastille flottante au-dessus des onglets (accueil, recherche) : la commande en cours, toujours à un geste.
export default function OngoingPill() {
  const t = useT();
  const history = useHistory();
  const ongoing = (history.data ?? []).filter((h) => h.ongoing);
  const o = ongoing[0];
  if (!o) return null;
  const [label, step] = STEP[o.status] ?? ["En cours", 0];
  return (
    <Link
      href={trackHref(o.code)}
      className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 mx-auto block max-w-md px-3"
    >
      <span className="anim-slide-up card-gloss block rounded-[20px] bg-white/95 p-3 backdrop-blur">
        <span className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-600/10 text-emerald-700">
            <Icon name={KIND[o.kind].icon} className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold">{t(label)}</span>
            <span className="block truncate text-[13px] text-stone-500">
              {t(o.title)} · {o.code}
            </span>
          </span>
          {ongoing.length > 1 ? (
            <span className="grid h-10 min-w-10 place-items-center rounded-xl bg-emerald-600/10 px-2 text-[13px] font-bold text-emerald-700">+{ongoing.length - 1}</span>
          ) : (
            <Icon name="chevron" className="h-4 w-4 text-stone-400" />
          )}
        </span>
        <span className="mt-2.5 grid grid-cols-5 gap-1" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1 rounded-full ${i < step ? "bg-emerald-600" : i === step ? "step-now" : "bg-stone-200"}`} />
          ))}
        </span>
      </span>
    </Link>
  );
}
