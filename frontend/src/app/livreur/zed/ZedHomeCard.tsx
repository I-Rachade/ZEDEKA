"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/panel/icons";
import { driverFetch } from "@/lib/driver";
import { useI18n } from "@/lib/i18n/client";
import { useDriver } from "../DriverShell";

// Mode Zed sur l'accueil : course en cours, interrupteur « Disponible pour les Zed », ou état du dossier.
export default function ZedHomeCard() {
  const { current, reload, setNotice } = useDriver();
  const [busy, setBusy] = useState(false);
  const { t, locale } = useI18n();
  const zed = current?.zed;
  if (!zed || (!zed.status && !zed.canApply)) return null;

  async function toggle() {
    setBusy(true);
    try {
      await driverFetch("/zed/available", {
        method: "PATCH",
        body: { available: !zed!.available },
      });
      await reload();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

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

  if (zed.status === "ACTIVE")
    return (
      <div className="space-y-2">
        <button
          onClick={toggle}
          disabled={busy}
          role="switch"
          aria-checked={zed.available}
          className={`flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left shadow ${zed.available ? "bg-sun text-ink" : "bg-ink/80 text-white"}`}
        >
          <span>
            <span className="block text-lg font-bold">{zed.available ? t("Disponible pour les Zed") : t("Zed : pas disponible")}</span>
            <span className={`block text-sm ${zed.available ? "text-ink/80" : "text-white/70"}`}>
              {zed.available ? t("Les clients à moins de 1 km peuvent vous appeler") : t("Activez pour recevoir les appels des clients proches")}
            </span>
          </span>
          <span className={`relative h-8 w-14 shrink-0 rounded-full transition ${zed.available ? "bg-ink" : "bg-white/30"}`}>
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${zed.available ? "left-7" : "left-1"}`} />
          </span>
        </button>
        <Link href="/livreur/zed" className="flex items-center justify-between rounded-2xl bg-white/15 px-4 py-2.5 text-sm text-white">
          <span>
            <span className="block text-white/75">{t("Plan Zed")}</span>
            <span className="block font-bold">
              {zed.planEndsAt
                ? t("Jusqu'au {date}", { date: new Date(zed.planEndsAt).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "Africa/Lome" }) })
                : t("Aucun plan en cours")}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-white/75">{t("Aujourd'hui")}</span>
            <span className="block font-bold">{t("{n} course(s) Zed", { n: zed.today ?? 0 })}</span>
          </span>
          <Icon name="chevron" className="h-4 w-4 shrink-0" />
        </Link>
      </div>
    );

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
      <span className="rounded-full bg-sun px-2 py-0.5 text-xs font-bold text-ink">ZED</span>
      <span className="flex-1 text-sm font-semibold">{text}</span>
      <Icon name="chevron" className="h-5 w-5" />
    </Link>
  );
}
