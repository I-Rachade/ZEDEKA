"use client";

import Link from "next/link";
import FavoriteDrivers from "@/components/FavoriteDrivers";
import { Icon } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";
import { merchantFetch } from "@/lib/merchant";

// Livreurs favoris de la boutique : ils reçoivent l'envoi entier en premier (un seul ramassage).
export default function MerchantDriversPage() {
  const t = useT();
  return (
    <div className="space-y-4 px-4 pb-6 pt-[calc(1rem+env(safe-area-inset-top))]">
      <header className="flex items-center gap-3">
        <Link href="/marchand" aria-label={t("Retour")} className="grid h-10 w-10 place-items-center rounded-full bg-stone-100">
          <Icon name="back" className="h-5 w-5" />
        </Link>
        <h1 className="text-[24px] font-bold">{t("Mes livreurs")}</h1>
      </header>
      <FavoriteDrivers api={merchantFetch} who="boutique" />
    </div>
  );
}
