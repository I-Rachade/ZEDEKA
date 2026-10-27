import type { Metadata } from "next";
import RentalShell from "./RentalShell";

export const metadata: Metadata = { title: "Espace loueur – Zedeka", robots: { index: false }, manifest: "/location/manifest.webmanifest", appleWebApp: { capable: true, title: "Location" } };

export default function RentalLayout({ children }: { children: React.ReactNode }) {
  return <RentalShell>{children}</RentalShell>;
}
