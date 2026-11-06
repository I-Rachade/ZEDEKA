import type { Metadata } from "next";
import { type ParcelCategory, type ParcelPricing, type Zone } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import Link from "next/link";
import ParcelForm from "./ParcelForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("Envoyer un colis")} – Zedeka`,
    description: t("Envoyez un colis partout à Lomé avec Zedeka : un livreur le récupère et le dépose à la bonne adresse."),
    alternates: { canonical: "/colis" },
  };
}

export default async function ParcelPage() {
  const [services, zones, categories, pricing, policies] = await Promise.all([
    serverGet<{ modules?: { code: string; state: string }[] }>("/api/services").catch(() => null),
    serverGet<Zone[]>("/api/zones"),
    serverGet<ParcelCategory[]>("/api/parcel-categories"),
    serverGet<ParcelPricing>("/api/parcel-pricing"),
    serverGet<{ mobileMoneyEnabled?: boolean; freeCancellationMinutes?: number; cancellationFeePercent?: number }>("/api/policies"),
  ]);
  // Module « Colis » coupé dans l'admin (l'API refuse aussi la création). Sans réponse, le formulaire reste ouvert.
  if (services?.modules && !services.modules.some((m) => m.code === "PARCEL" && m.state === "ON")) return <ParcelClosed />;
  return (
    <ParcelForm
      zones={zones ?? []}
      categories={categories ?? []}
      pricing={pricing ?? { minFee: 1000, perKmFee: 200, maxFee: null }}
      mobileMoney={!!policies?.mobileMoneyEnabled}
      cancellation={
        policies?.freeCancellationMinutes !== undefined && policies.cancellationFeePercent !== undefined
          ? { freeCancellationMinutes: policies.freeCancellationMinutes, cancellationFeePercent: policies.cancellationFeePercent }
          : null
      }
    />
  );
}

async function ParcelClosed() {
  const t = await getT();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-[14px] bg-sun-soft text-[32px]" aria-hidden="true">
        📦
      </span>
      <h1 className="text-[22px] font-bold">{t("L'envoi de colis est fermé pour le moment.")}</h1>
      <p className="text-stone-500">{t("Revenez bientôt. Les repas restent disponibles.")}</p>
      <Link href="/app" className="rounded-[12px] bg-emerald-600 px-5 py-3 font-semibold text-white">
        {t("Retour à l'accueil")}
      </Link>
    </main>
  );
}
