import type { Metadata } from "next";
import RentalShell from "./RentalShell";

export const metadata: Metadata = { title: "Espace loueur – Zedeka", robots: { index: false } };

export default function RentalLayout({ children }: { children: React.ReactNode }) {
  return <RentalShell>{children}</RentalShell>;
}
