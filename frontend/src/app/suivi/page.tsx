import type { Metadata } from "next";
import { TopBar } from "@/app/app/ui";
import TrackForm from "./TrackForm";

export const metadata: Metadata = { title: "Suivre une commande – Zedeka" };

export default function TrackPage() {
  return (
    <>
      <TopBar title="Suivre une commande" back="/app/commandes" />
      <div className="space-y-4 p-4">
        <p className="text-sm text-stone-600">Repas ou colis : saisissez le code reçu et le numéro de téléphone utilisé pour commander.</p>
        <TrackForm />
      </div>
    </>
  );
}
