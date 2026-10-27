import type { Metadata } from "next";
import RestaurantShell from "./RestaurantShell";

export const metadata: Metadata = { title: "Espace restaurant – Zedeka", robots: { index: false }, manifest: "/restaurant/manifest.webmanifest", appleWebApp: { capable: true, title: "Restaurant" } };

export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  return <RestaurantShell>{children}</RestaurantShell>;
}
