// Application installable de l'espace location : s'ouvre sur le tableau de bord.
export function GET() {
  return Response.json(
    {
      name: "Zedeka Location",
      short_name: "Location",
      description: "Recevez et gérez vos réservations Zedeka.",
      id: "/location",
      start_url: "/location",
      scope: "/location",
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
