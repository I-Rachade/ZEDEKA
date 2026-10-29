import type { Metadata, Viewport } from "next";
import { getT } from "@/lib/i18n/server";
import DriverShell from "./DriverShell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Livreur")} – Zedeka`, robots: { index: false }, manifest: "/livreur/manifest.webmanifest", appleWebApp: { capable: true, title: t("Livreur") } };
}
export const viewport: Viewport = { themeColor: "#0A6A3F" };

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <DriverShell>{children}</DriverShell>;
}
