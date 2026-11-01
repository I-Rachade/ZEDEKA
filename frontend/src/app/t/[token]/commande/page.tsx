import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getT } from "@/lib/i18n/server";
import { serverGet } from "@/lib/serverApi";
import { loadTable } from "../loadTable";
import TableCheckout from "./TableCheckout";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Valider la commande")} – Zedeka`, robots: { index: false } };
}

export default async function TableCheckoutPage({ params }: Props) {
  const { token } = await params;
  const [found, policies] = await Promise.all([loadTable(token), serverGet<{ mobileMoneyEnabled?: boolean }>("/api/policies")]);
  if (!found) notFound();
  return <TableCheckout restaurant={found.restaurant} table={{ number: found.table.number, token }} mobileMoney={!!policies?.mobileMoneyEnabled} />;
}
