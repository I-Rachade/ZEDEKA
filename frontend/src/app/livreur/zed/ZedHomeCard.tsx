"use client";

import Link from "next/link";
import { Icon } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";
import { useDriver } from "../DriverShell";

// Mode Zed sur l'accueil : course en cours, ou état du dossier (le conducteur actif a son propre bloc sur l'accueil).
export default function ZedHomeCard() {
  const { current } = useDriver();
  const t = useT();
  const zed = current?.zed;
  if (!zed || (!zed.status && !zed.canApply)) return null;

  if (zed.ride)
    return (
      <Link href={`/livreur/zed/course/${zed.ride.id}`} className="flex items-center gap-3 rounded-2xl bg-sun p-4 text-ink shadow">
        <Icon name="rider" className="h-8 w-8 shrink-0" />
        <span className="flex-1">
          <span className="block text-lg font-bold">{zed.ride.status === "ONBOARD" ? t("Client à bord") : t("Client à chercher")}</span>
          <span className="block text-sm">
            {t("Course Zed {code} · touchez pour l'ouvrir", {
              code: zed.ride.code,
            })}
          </span>
        </span>
        <Icon name="chevron" className="h-5 w-5" />
      </Link>
    );

  // Conducteur Zed actif : l'accueil montre lui-même le plan, l'interrupteur et les compteurs.
  if (zed.status === "ACTIVE") return null;
  const text =
    zed.status === "PENDING"
      ? t("Dossier Zed en cours de vérification")
      : zed.status === "REJECTED"
        ? t("Dossier Zed non retenu")
        : zed.status === "SUSPENDED"
          ? t("Mode Zed suspendu")
          : t("Devenir conducteur Zed");
  return (
    <Link href="/livreur/zed" className="flex items-center gap-3 rounded-2xl bg-ink/80 px-4 py-3 text-white shadow">
      <span className="rounded-full bg-sun px-2 py-1 text-xs font-bold text-ink">ZED</span>
      <span className="flex-1 text-sm font-semibold">{text}</span>
      <Icon name="chevron" className="h-5 w-5" />
    </Link>
  );
}
