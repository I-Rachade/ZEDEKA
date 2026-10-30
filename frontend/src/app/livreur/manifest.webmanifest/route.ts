import { getLang } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n";

// Application installable du livreur : s'ouvre sur les courses, dans la langue choisie.
export async function GET() {
  const lang = await getLang();
  const t = (fr: string) => translate(lang, fr);
  return Response.json(
    {
      name: t("Zedeka Livreur"),
      short_name: t("Livreur"),
      description: t("Recevez et livrez vos courses Zedeka."),
      id: "/livreur",
      start_url: "/livreur",
      scope: "/livreur",
      display: "standalone",
      background_color: "#F4F7F4",
      theme_color: "#0E7C4A",
      lang,
      icons: [
        { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
