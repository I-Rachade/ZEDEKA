import type { Metadata } from "next";
import TrackForm from "./TrackForm";

export const metadata: Metadata = { title: "Suivre une commande – Zedeka" };

export default function TrackPage() {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Suivre une commande</h1>
        <p className="text-sm text-stone-600">Repas ou colis : saisissez le code reçu et le numéro de téléphone utilisé pour commander.</p>
      </div>
      <TrackForm />
    </div>
  );
}
