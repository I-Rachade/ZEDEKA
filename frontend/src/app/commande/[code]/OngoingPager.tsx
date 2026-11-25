"use client";

import { useRouter } from "next/navigation";
import { useHistory } from "@/app/app/data";
import { trackHref } from "@/lib/device";
import { useT } from "@/lib/i18n/client";
import { useSwipe } from "@/lib/swipe";

// Plusieurs commandes en cours (un repas et un colis, par exemple) : on glisse d'un suivi à l'autre sans repasser
// par la liste. Les points montrent où l'on est ; rien ne s'affiche avec une seule commande en cours.
export default function OngoingPager({ code }: { code: string }) {
  const router = useRouter();
  const t = useT();
  const history = useHistory();
  const ongoing = (history.data ?? []).filter((h) => h.ongoing);
  const index = ongoing.findIndex((h) => h.code === code);
  const many = index >= 0 && ongoing.length > 1;
  const go = (i: number) => ongoing[i] && router.replace(trackHref(ongoing[i].code));
  useSwipe({ onLeft: () => go(index + 1), onRight: () => go(index - 1) }, many);

  if (!many) return null;
  const next = ongoing[index + 1] ?? ongoing[index - 1];
  return (
    <nav aria-label={t("Commandes en cours")} className="flex items-center justify-center gap-2 text-[12px] text-stone-500">
      {ongoing.map((h, i) => (
        <button
          key={h.code}
          type="button"
          onClick={() => go(i)}
          aria-label={`${t(h.kind === "PARCEL" ? "Colis" : "Repas")} ${h.code}`}
          aria-current={i === index ? "page" : undefined}
          className={`h-2 rounded-full transition-all ${i === index ? "w-5 bg-emerald-600" : "w-2 bg-stone-300"}`}
        />
      ))}
      <span className="ml-1">
        {index + 1} / {ongoing.length} · {t(next.kind === "PARCEL" ? "glissez pour voir votre colis" : "glissez pour voir votre repas")}
      </span>
    </nav>
  );
}
