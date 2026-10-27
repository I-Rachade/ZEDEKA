import type { Metadata, Viewport } from "next";
import PublicChrome from "@/components/PublicChrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zedeka – Livraison et repas à Lomé",
  description: "Commandez, le livreur est déjà en route.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#059669",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <PublicChrome>{children}</PublicChrome>
      </body>
    </html>
  );
}
