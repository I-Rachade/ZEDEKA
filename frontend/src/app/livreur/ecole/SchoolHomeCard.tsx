"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/panel/icons";
import { driverFetch } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import type { TripStatus } from "@/lib/school";
import { useDriver } from "../DriverShell";

type Brief = { trips: { status: TripStatus; scheduledAt: string }[]; passes: unknown[] };

// Transport scolaire sur l'accueil (conducteurs Zed attitrés) : trajets du jour restants et le prochain.
export default function SchoolHomeCard() {
  const { current } = useDriver();
  const { t } = useI18n();
  const [brief, setBrief] = useState<Brief | null>(null);
  const zed = current?.zed?.status === "ACTIVE";
  useEffect(() => {
    if (!zed) return;
    driverFetch<Brief>("/school").then(setBrief).catch(() => {});
  }, [zed]);
  if (!zed || !brief || brief.passes.length === 0) return null;
  const left = brief.trips.filter((tr) => tr.status === "PLANNED" || tr.status === "ON_THE_WAY" || tr.status === "PICKED_UP");
  const next = left[0];
  return (
    <Link href="/livreur/ecole" className="flex items-center gap-3 rounded-2xl bg-white/15 px-4 py-3 text-white shadow">
      <span className="text-xl" aria-hidden="true">
        🎒
      </span>
      <span className="flex-1 text-sm font-semibold">
        {left.length === 0 ? t("Transport scolaire : rien d'autre aujourd'hui") : t("Transport scolaire : {n} trajet(s) aujourd'hui", { n: left.length })}
        {next && <span className="block text-xs font-normal opacity-80">{t("Prochain à {time}", { time: next.scheduledAt.slice(11, 16) })}</span>}
      </span>
      <Icon name="chevron" className="h-5 w-5" />
    </Link>
  );
}
