"use client";

import { useI18n } from "@/lib/i18n/client";
import { PASS_STATUS, type PassStatus } from "@/lib/school";

// Transport scolaire (admin) : badge d'état partagé par la liste et la fiche d'un abonnement.
export function PassPill({ status }: { status: PassStatus }) {
  const t = useI18n().t;
  return <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold whitespace-nowrap ${PASS_STATUS[status].tone}`}>{t(PASS_STATUS[status].label)}</span>;
}
