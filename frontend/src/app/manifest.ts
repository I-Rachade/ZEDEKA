import type { MetadataRoute } from "next";
import { getLang } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n";

// Dans la langue choisie au moment de l'installation.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const lang = await getLang();
  const t = (fr: string) => translate(lang, fr);
  return {
    name: t("Zedeka – Repas et colis à Lomé"),
    short_name: "Zedeka",
    description: t("Commandez vos repas et envoyez vos colis à Lomé."),
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#F4F7F4",
    theme_color: "#0E7C4A",
    lang,
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
