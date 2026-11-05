import { getLang } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n";

// Application installable du marchand : s'ouvre sur le tableau de bord de la boutique, dans la langue choisie.
export async function GET() {
  const lang = await getLang();
  const t = (fr: string) => translate(lang, fr);
  return Response.json(
    {
      name: t("Zedeka Marchand"),
      short_name: t("Marchand"),
      description: t("Envoyez les colis de votre boutique en ligne avec Zedeka."),
      id: "/marchand",
      start_url: "/marchand",
      scope: "/marchand",
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
