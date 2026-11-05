"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";
import { useSwipe } from "@/lib/swipe";
import { useZedConfig } from "@/lib/zed";

// Haut de la page Zed (bouton du milieu) : « Colis » et « Course » côte à côte. On passe de l'un à l'autre
// d'un appui ou en glissant le doigt. Mode Zed fermé : seul le colis reste, sans sélecteur.
export default function ZedSwitch({ current }: { current: "parcel" | "ride" }) {
  const router = useRouter();
  const t = useT();
  const { enabled } = useZedConfig();
  useSwipe(
    {
      onLeft: () => current === "parcel" && router.push("/app/zed"),
      onRight: () => current === "ride" && router.push("/colis"),
    },
    enabled,
  );
  if (!enabled) return null;
  const tab = (on: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-[15px] transition ${on ? "bg-white font-semibold text-stone-900 shadow-sm" : "text-stone-500"}`;
  return (
    <div className="px-4 pt-3">
      <nav aria-label={t("Colis ou course")} className="flex gap-1 rounded-[10px] bg-stone-200/70 p-1">
        <Link href="/colis" replace aria-current={current === "parcel" ? "page" : undefined} className={tab(current === "parcel")}>
          <Icon name="box" className="h-4 w-4" /> {t("Colis")}
        </Link>
        <Link href="/app/zed" replace aria-current={current === "ride" ? "page" : undefined} className={tab(current === "ride")}>
          <Icon name="rider" className="h-4 w-4" /> {t("Course Zed")}
        </Link>
      </nav>
      <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px] text-stone-400" aria-hidden="true">
        <span className={`h-1.5 rounded-full ${current === "parcel" ? "w-4 bg-emerald-600" : "w-1.5 bg-stone-300"}`} />
        <span className={`h-1.5 rounded-full ${current === "ride" ? "w-4 bg-emerald-600" : "w-1.5 bg-stone-300"}`} />
        <span className="ml-1">{t("glissez pour changer")}</span>
      </p>
    </div>
  );
}
