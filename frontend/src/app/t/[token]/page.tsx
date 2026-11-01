import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type TableInfo } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import RestaurantView from "@/app/r/[slug]/RestaurantView";
import { loadTable } from "./loadTable";

type Props = { params: Promise<{ token: string }> };

// QR code posé sur une table : la carte du restaurant, en mode « sur place » (servi à table, sans livraison).
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const found = await serverGet<TableInfo>(`/api/tables/${encodeURIComponent(token)}`);
  const t = await getT();
  if (!found) return { title: `${t("Table introuvable")} – Zedeka`, robots: { index: false } };
  return { title: `${t("Table {number}", { number: found.number })} · ${found.restaurant.name} – Zedeka`, robots: { index: false } };
}

export default async function TablePage({ params }: Props) {
  const { token } = await params;
  const found = await loadTable(token);
  if (!found) notFound();
  return <RestaurantView restaurant={found.restaurant} table={{ number: found.table.number, token }} />;
}
