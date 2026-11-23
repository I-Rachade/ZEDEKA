import type { Metadata, Viewport } from "next";
import { getT } from "@/lib/i18n/server";

// Appli mobile de l'admin, installable : le manifeste est servi hors de /admin (protégé par Cloudflare Access,
// que le navigateur ne passe pas pour lire un manifeste).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Zedeka Pilote")}`, robots: { index: false }, manifest: "/admin-mobile.webmanifest", appleWebApp: { capable: true, title: t("Pilote"), statusBarStyle: "black-translucent" } };
}

export const viewport: Viewport = { themeColor: "#1c1917", viewportFit: "cover" };

export default function MobileAdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
