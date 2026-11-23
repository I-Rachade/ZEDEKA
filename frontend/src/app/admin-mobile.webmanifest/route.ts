import { getLang } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n";

// Appli mobile de l'admin (/admin/mobile) : les écrans, les chiffres et les alertes critiques sur le téléphone du
// directeur. Hors de /admin pour que le navigateur puisse lire le manifeste sans passer par Cloudflare Access.
export async function GET() {
  const lang = await getLang();
  const t = (fr: string) => translate(lang, fr);
  return Response.json(
    {
      name: t("Zedeka Pilote"),
      short_name: t("Pilote"),
      description: t("Les écrans, les chiffres et les alertes critiques de Zedeka, sur le téléphone."),
      id: "/admin/mobile",
      start_url: "/admin/mobile",
      scope: "/admin",
      display: "standalone",
      orientation: "portrait",
      background_color: "#1c1917",
      theme_color: "#1c1917",
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
