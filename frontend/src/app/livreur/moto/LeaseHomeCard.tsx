"use client";

import Link from "next/link";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { useDriver } from "../DriverShell";

// Moto en leasing sur l'accueil : payée jusqu'à quand, ou le montant à payer (rouge en cas de retard).
export default function LeaseHomeCard() {
  const { current } = useDriver();
  const { t, locale } = useI18n();
  const lease = current?.lease;
  if (!lease) return null;
  const late = lease.state === "LATE";
  const until = lease.paidUntil ? new Date(`${lease.paidUntil}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", timeZone: "UTC" }) : null;
  const text = late
    ? t("Leasing en retard : {amount} à payer", { amount: fcfa(lease.owed) })
    : lease.state === "DUE_TODAY"
      ? t("Leasing : {amount} à payer aujourd'hui", { amount: fcfa(lease.owed) })
      : t("Leasing payé jusqu'au {date}", { date: until ?? "" });
  return (
    <Link href="/livreur/moto" className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow ${late ? "bg-red-600 text-white" : lease.state === "DUE_TODAY" ? "bg-amber-100 text-amber-900" : "bg-white/15 text-white"}`}>
      <Icon name="rider" className="h-5 w-5 shrink-0" />
      <span className="flex-1 text-sm font-semibold">
        {text}
        <span className="block font-mono text-xs font-normal opacity-80">{lease.plate}</span>
      </span>
      <Icon name="chevron" className="h-5 w-5" />
    </Link>
  );
}
