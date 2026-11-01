import type { Metadata } from "next";
import { getT } from "@/lib/i18n/server";
import VendorApplyForm from "./VendorApplyForm";
import styles from "./page.module.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: `${t("Devenir partenaire")} – Zedeka`,
    description: t("Inscrivez votre restaurant ou votre commerce sur Zedeka et faites-vous livrer partout à Lomé."),
  };
}

export default async function DevenirPartenairePage() {
  const t = await getT();
  return (
    <main id="contenu" className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>{t("Zedeka Partenaires")}</p>
        <h1>{t("Vendez plus, on s'occupe de la livraison")}</h1>
        <p>
          {t("Restaurants, maquis, épiceries, pharmacies : inscrivez votre commerce en 5 minutes. Notre équipe vous rappelle sous 48 h pour activer votre page et votre QR code.")}
        </p>
      </header>
      <VendorApplyForm />
    </main>
  );
}
