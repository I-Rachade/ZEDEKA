"use client";

import Link from "next/link";
import { Icon } from "@/components/panel/icons";
import { useT } from "@/lib/i18n/client";
import { useDriver } from "../DriverShell";

// Missions de service sur l'accueil du livreur : seulement s'il a un service (courses, gaz, lessive…) dans son profil.
export default function MissionsCard() {
  const { current } = useDriver();
  const t = useT();
  const m = current?.missions;
  if (!m) return null;
  const busy = m.active > 0;
  return (
    <Link href="/livreur/missions" className={`flex items-center gap-3 rounded-2xl p-4 shadow ${busy ? "bg-sun text-ink-deep" : "bg-white/12 text-white"}`}>
      <span className="text-[28px]" aria-hidden="true">
        🧰
      </span>
      <span className="flex-1">
        <span className="block text-lg font-bold">{busy ? t("{n} mission(s) en cours", { n: m.active }) : t("Missions de service")}</span>
        <span className="block text-sm opacity-80">{m.available ? t("{n} demande(s) à prendre", { n: m.available }) : t("Aucune demande pour le moment")}</span>
      </span>
      <Icon name="chevron" className="h-5 w-5" />
    </Link>
  );
}
