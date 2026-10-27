import type { Metadata } from "next";
import { apiGet, type ParcelCategory, type Zone } from "@/lib/api";
import ParcelForm from "./ParcelForm";

export const metadata: Metadata = { title: "Envoyer un colis – Zedeka" };

export default async function ParcelPage() {
  const [zones, categories] = await Promise.all([
    apiGet<Zone[]>("/api/zones"),
    apiGet<ParcelCategory[]>("/api/parcel-categories"),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Envoyer un colis</h1>
        <p className="text-sm text-stone-600">Documents, marchandises ou paquets, livrés dans Lomé au prix de la zone.</p>
      </div>
      <ParcelForm zones={zones ?? []} categories={categories ?? []} />
    </div>
  );
}
