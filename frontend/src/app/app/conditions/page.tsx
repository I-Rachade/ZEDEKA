import type { Metadata } from "next";
import { getLang, getT } from "@/lib/i18n/server";
import InfoPage from "../InfoPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Conditions d'utilisation")} – Zedeka` };
}

// Texte juridique : rédigé dans chaque langue plutôt que phrase par phrase (i18n-ignore-file).
export default async function Terms() {
  if ((await getLang()) === "en") {
    return (
      <InfoPage title="Conditions d'utilisation">
        <p>Zedeka connects customers in Lomé with partner restaurants and riders.</p>
        <section>
          <h2>Orders</h2>
          <ul>
            <li>Prices shown are set by partners; the total is recalculated and confirmed when you order.</li>
            <li>Delivery fees depend on the area, and sometimes on the distance.</li>
            <li>The restaurant may decline an order (out of stock, closed); you are told right away.</li>
          </ul>
        </section>
        <section>
          <h2>Payment</h2>
          <p>Cash on delivery or mobile money. A receipt is available from Zedeka on request.</p>
        </section>
        <section>
          <h2>Your account</h2>
          <ul>
            <li>Your account is linked to your phone number, verified with a one-time code.</li>
            <li>You can delete it at any time from your profile.</li>
            <li>Delivery details must be accurate so the rider can find you.</li>
          </ul>
        </section>
        <section>
          <h2>Liability</h2>
          <p>Meals are prepared under the restaurants&apos; responsibility. Zedeka handles every complaint and acts as the intermediary.</p>
        </section>
      </InfoPage>
    );
  }
  return (
    <InfoPage title="Conditions d'utilisation">
      <p>Zedeka met en relation des clients de Lomé avec des restaurants et des livreurs partenaires.</p>
      <section>
        <h2>Commandes</h2>
        <ul>
          <li>Les prix affichés sont ceux des partenaires ; le total est recalculé et confirmé au moment de la commande.</li>
          <li>Les frais de livraison dépendent de la zone, et parfois de la distance.</li>
          <li>Le restaurant peut refuser une commande (rupture, fermeture) ; vous en êtes informé aussitôt.</li>
        </ul>
      </section>
      <section>
        <h2>Paiement</h2>
        <p>En espèces à la livraison ou par mobile money. Le reçu est disponible auprès de Zedeka sur simple demande.</p>
      </section>
      <section>
        <h2>Votre compte</h2>
        <ul>
          <li>Le compte est lié à votre numéro de téléphone, vérifié par un code à usage unique.</li>
          <li>Vous pouvez le supprimer à tout moment depuis votre profil.</li>
          <li>Les informations de livraison doivent être exactes pour que le livreur vous trouve.</li>
        </ul>
      </section>
      <section>
        <h2>Responsabilité</h2>
        <p>Les plats sont préparés sous la responsabilité des restaurants. Zedeka traite toute réclamation et sert d&apos;intermédiaire.</p>
      </section>
    </InfoPage>
  );
}
