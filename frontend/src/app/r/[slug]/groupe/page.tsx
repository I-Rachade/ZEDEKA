import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type Restaurant } from "@/lib/api";
import { getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import GroupStart from "./GroupStart";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Commande groupée")} – Zedeka` };
}

export default async function GroupStartPage({ params }: Props) {
  const { slug } = await params;
  const restaurant = await serverGet<Restaurant>(`/api/restaurants/${encodeURIComponent(slug)}`);
  if (!restaurant) notFound();
  return <GroupStart restaurant={restaurant} />;
}
