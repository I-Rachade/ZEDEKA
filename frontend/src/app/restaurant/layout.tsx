import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import RestaurantShell from "./RestaurantShell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Espace restaurant")} – Zedeka`, robots: { index: false }, manifest: "/restaurant/manifest.webmanifest", appleWebApp: { capable: true, title: "Restaurant" } };
}

export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  return <RestaurantShell>{children}</RestaurantShell>;
}
