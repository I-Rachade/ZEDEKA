import type { Metadata } from "next";
import { TopBar } from "@/app/app/ui";
import { getT } from "@/lib/i18n/server";
import TrackForm from "./TrackForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Suivre une commande")} – Zedeka` };
}

export default async function TrackPage() {
  const t = await getT();
  return (
    <>
      <TopBar title="Suivre une commande" back="/app/commandes" />
      <div className="space-y-4 p-4">
        <p className="text-sm text-stone-600">{t("Repas ou colis : saisissez le code reçu et le numéro de téléphone utilisé pour commander.")}</p>
        <TrackForm />
      </div>
    </>
  );
}
