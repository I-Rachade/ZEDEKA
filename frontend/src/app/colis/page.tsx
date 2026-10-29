import type { Metadata } from "next";
import { type ParcelCategory, type Zone } from "@/lib/api";
import { serverGet } from "@/lib/serverApi";
import ParcelForm from "./ParcelForm";

export const metadata: Metadata = { title: "Envoyer un colis – Zedeka" };

export default async function ParcelPage() {
  const [zones, categories] = await Promise.all([
    serverGet<Zone[]>("/api/zones"),
    serverGet<ParcelCategory[]>("/api/parcel-categories"),
  ]);
  return <ParcelForm zones={zones ?? []} categories={categories ?? []} />;
}
