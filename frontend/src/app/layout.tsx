import type { Metadata, Viewport } from "next";
import { I18nProvider } from "@/lib/i18n/client";
import { getLang, getT } from "@/lib/i18n/server";
import { Poppins } from "next/font/google";
import AppRuntime from "@/components/AppRuntime";
import CookieNotice from "@/components/legal/CookieNotice";
import PublicChrome from "@/components/PublicChrome";
import "./globals.css";

// Une seule famille téléchargée, pour les titres, servie par le site lui-même et mise en cache.
const poppins = Poppins({ subsets: ["latin"], weight: ["600", "800"], display: "swap", variable: "--font-poppins" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Zedeka – Livraison et repas à Lomé"),
    description: t("Commandé, livré. En un clic."),
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
  const t = await getT();
  return (
    <html lang={lang} className={poppins.variable}>
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <I18nProvider lang={lang}>
          {/* Premier arrêt de la touche Tab : sauter l'en-tête et aller au contenu. */}
          <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-xl focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:text-emerald-800 focus:shadow-lg">
            {t("Aller au contenu")}
          </a>
          <AppRuntime />
          <PublicChrome>{children}</PublicChrome>
          <CookieNotice />
        </I18nProvider>
      </body>
    </html>
  );
}
