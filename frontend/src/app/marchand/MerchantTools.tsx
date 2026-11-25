"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";

const TOOLS: { href: string; label: string; icon: IconName }[] = [
  { href: "/marchand/caisse", label: "Caisse", icon: "receipt" },
  { href: "/marchand/stock", label: "Stock", icon: "grid" },
  { href: "/marchand/logistique", label: "Logistique", icon: "box" },
];

// Accès rapide de l'accueil marchand : caisse (POS), gestion de stock, logistique Zedeka (entrepôt, retours).
export default function MerchantTools() {
  const t = useT();
  return (
    <nav aria-label={t("Outils de la boutique")} className="grid grid-cols-3 gap-2">
      {TOOLS.map((tool) => (
        <Link key={tool.href} href={tool.href} className="flex flex-col items-center gap-1 rounded-2xl bg-surface p-3 text-[13px] font-semibold shadow-[0_1px_2px_rgb(0_0_0/0.06)] ring-1 ring-black/5 active:scale-[0.98]">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <Icon name={tool.icon} className="h-5 w-5" />
          </span>
          {t(tool.label)}
        </Link>
      ))}
    </nav>
  );
}
