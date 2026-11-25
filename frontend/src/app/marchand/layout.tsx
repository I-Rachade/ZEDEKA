import type { Metadata, Viewport } from "next";
import { getT } from "@/lib/i18n/server";
import MerchantShell from "./MerchantShell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Espace marchand")} – Zedeka`, robots: { index: false }, manifest: "/marchand/manifest.webmanifest", appleWebApp: { capable: true, title: t("Marchand") } };
}
export const viewport: Viewport = { themeColor: "#0A6A3F" };

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <MerchantShell>{children}</MerchantShell>;
}
