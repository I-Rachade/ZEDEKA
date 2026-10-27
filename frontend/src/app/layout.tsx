import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import AppRuntime from "@/components/AppRuntime";
import PublicChrome from "@/components/PublicChrome";
import "./globals.css";

// Une seule famille téléchargée, pour les titres, servie par le site lui-même et mise en cache.
const poppins = Poppins({ subsets: ["latin"], weight: ["600", "800"], display: "swap", variable: "--font-poppins" });

export const metadata: Metadata = {
  title: "Zedeka – Livraison et repas à Lomé",
  description: "Commandé, livré. En un clic.",
  appleWebApp: { capable: true, title: "Zedeka", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E7C4A",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={poppins.variable}>
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <AppRuntime />
        <PublicChrome>{children}</PublicChrome>
      </body>
    </html>
  );
}
