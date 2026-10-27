import type { Metadata } from "next";
import VendorApplyForm from "./VendorApplyForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Devenir partenaire – Zedeka",
  description: "Inscrivez votre restaurant ou votre commerce sur Zedeka et faites-vous livrer partout à Lomé.",
};

export default function DevenirPartenairePage() {
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.kicker}>Zedeka Partenaires</p>
        <h1>Vendez plus, on s&apos;occupe de la livraison</h1>
        <p>
          Restaurants, maquis, épiceries, pharmacies : inscrivez votre commerce en 5 minutes. Notre équipe vous rappelle
          sous 48 h pour activer votre page et votre QR code.
        </p>
      </header>
      <VendorApplyForm />
    </main>
  );
}
