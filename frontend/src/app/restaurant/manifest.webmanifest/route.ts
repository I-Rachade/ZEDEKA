// Application installable de l'espace restaurant : s'ouvre sur le tableau de bord.
export function GET() {
  return Response.json(
    {
      name: "Zedeka Restaurant",
      short_name: "Restaurant",
      description: "Recevez et gérez vos commandes Zedeka.",
      id: "/restaurant",
      start_url: "/restaurant",
      scope: "/restaurant",
      display: "standalone",
      background_color: "#F4F7F4",
      theme_color: "#0E7C4A",
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
