import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import { SITE_URL } from "@/lib/site";
import AppShell from "./AppShell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("Zedeka – Livraison de repas et de colis à Lomé"),
    description: t("Commandez vos repas dans les restaurants de Lomé et envoyez vos colis dans toute la ville. Livraison rapide, paiement à la livraison ou par mobile money."),
    alternates: { canonical: "/app" },
  };
}

// Carte d'identité du site pour Google (nom, adresse, zone servie).
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, name: "Zedeka", url: `${SITE_URL}/app`, inLanguage: "fr" },
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#org`,
      name: "Zedeka",
      url: `${SITE_URL}/app`,
      logo: `${SITE_URL}/icon.svg`,
      areaServed: { "@type": "City", name: "Lomé", address: { "@type": "PostalAddress", addressLocality: "Lomé", addressCountry: "TG" } },
    },
  ],
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <AppShell>{children}</AppShell>
    </>
  );
}
