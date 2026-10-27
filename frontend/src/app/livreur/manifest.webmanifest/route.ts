// Application installable du livreur : s'ouvre sur les courses.
export function GET() {
  return Response.json(
    {
      name: "Zedeka Livreur",
      short_name: "Livreur",
      description: "Recevez et livrez vos courses Zedeka.",
      id: "/livreur",
      start_url: "/livreur",
      scope: "/livreur",
      display: "standalone",
      background_color: "#f5f5f4",
      theme_color: "#059669",
      lang: "fr",
      icons: [
        { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
