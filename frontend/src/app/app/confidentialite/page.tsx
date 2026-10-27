import type { Metadata } from "next";
import InfoPage from "../InfoPage";

export const metadata: Metadata = { title: "Confidentialité – Zedeka" };

export default function Privacy() {
  return (
    <InfoPage title="Confidentialité">
      <section>
        <h2>Ce que nous enregistrons</h2>
        <ul>
          <li>Votre numéro de téléphone et votre nom.</li>
          <li>Vos adresses enregistrées : quartier, repère et, si vous le choisissez, votre position.</li>
          <li>Vos commandes : contenu, montants, statut.</li>
        </ul>
      </section>
      <section>
        <h2>Pourquoi</h2>
        <p>Uniquement pour livrer vos commandes, vous contacter à leur sujet et tenir la comptabilité avec nos partenaires.</p>
      </section>
      <section>
        <h2>Qui y a accès</h2>
        <p>Le restaurant ou le loueur concerné et le livreur voient le nom, le numéro et l&apos;adresse de la commande. Nous ne vendons pas vos données.</p>
      </section>
      <section>
        <h2>Sur votre téléphone</h2>
        <p>Le panier, l&apos;adresse choisie et la session sont gardés sur votre téléphone. Se déconnecter efface la session.</p>
      </section>
      <section>
        <h2>Suppression</h2>
        <p>Depuis votre profil, « Supprimer mon compte » efface vos adresses et détache vos commandes de votre numéro. Les commandes elles-mêmes restent dans la comptabilité.</p>
      </section>
    </InfoPage>
  );
}
