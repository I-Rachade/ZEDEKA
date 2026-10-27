import type { Metadata, Viewport } from "next";
import DriverShell from "./DriverShell";

export const metadata: Metadata = { title: "Livreur – Zedeka", robots: { index: false }, manifest: "/livreur/manifest.webmanifest", appleWebApp: { capable: true, title: "Livreur" } };
export const viewport: Viewport = { themeColor: "#047857" };

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return <DriverShell>{children}</DriverShell>;
}
