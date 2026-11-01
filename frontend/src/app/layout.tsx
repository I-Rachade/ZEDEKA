import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/lib/i18n/client";
import { getLang, getT } from "@/lib/i18n/server";
import { Poppins } from "next/font/google";
import AppRuntime from "@/components/AppRuntime";
import PublicChrome from "@/components/PublicChrome";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

// Une seule famille téléchargée, pour les titres, servie par le site lui-même et mise en cache.
const poppins = Poppins({ subsets: ["latin"], weight: ["600", "800"], display: "swap", variable: "--font-poppins" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const lang = await getLang();
  return {
    metadataBase: new URL(SITE_URL),
    title: t("Zedeka – Livraison et repas à Lomé"),
    description: t("Commandé, livré. En un clic."),
    applicationName: "Zedeka",
    openGraph: { type: "website", siteName: "Zedeka", locale: lang === "en" ? "en_GB" : "fr_FR" },
    appleWebApp: { capable: true, title: "Zedeka", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E7C4A",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = await getLang();
  return (
    <html lang={lang} className={poppins.variable}>
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <I18nProvider lang={lang}>
          <AppRuntime />
          <PublicChrome>{children}</PublicChrome>
        </I18nProvider>
      </body>
    </html>
  );
}
