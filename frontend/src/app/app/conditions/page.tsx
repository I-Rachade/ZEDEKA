import type { Metadata } from "next";
import InfoPage from "../InfoPage";

export const metadata: Metadata = { title: "Conditions d'utilisation – Zedeka" };

export default function Terms() {
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
