import type { Metadata } from "next";
import { getLang, getT } from "@/lib/i18n/server";
import InfoPage from "../InfoPage";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Confidentialité")} – Zedeka` };
}

// Texte juridique : rédigé dans chaque langue plutôt que phrase par phrase (i18n-ignore-file).
export default async function Privacy() {
  if ((await getLang()) === "en") {
    return (
      <InfoPage title="Confidentialité">
        <section>
          <h2>What we store</h2>
          <ul>
            <li>Your phone number and your name.</li>
            <li>Your saved addresses: neighbourhood, landmark and, if you choose, your location.</li>
            <li>Your orders: contents, amounts, status.</li>
          </ul>
        </section>
        <section>
          <h2>Why</h2>
          <p>Only to deliver your orders, contact you about them and keep the accounts with our partners.</p>
        </section>
        <section>
          <h2>Who can see it</h2>
          <p>The restaurant concerned and the rider see the order&apos;s name, number and address. We do not sell your data.</p>
        </section>
        <section>
          <h2>Location of a parcel recipient</h2>
          <p>
            The sender can send the recipient a link to share their location. Nothing is sent without their consent, the location is taken only once,
            and only the rider and Zedeka see it, not the sender. The link expires after 24 hours or as soon as the parcel is picked up. The location is
            erased 30 days after delivery.
          </p>
        </section>
        <section>
          <h2>On your phone</h2>
          <p>The cart, the chosen address and the session are kept on your phone. Logging out erases the session.</p>
        </section>
        <section>
          <h2>Deletion</h2>
          <p>From your profile, “Delete my account” erases your addresses and unlinks your orders from your number. The orders themselves stay in the accounts.</p>
        </section>
      </InfoPage>
    );
  }
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
        <p>Le restaurant concerné et le livreur voient le nom, le numéro et l&apos;adresse de la commande. Nous ne vendons pas vos données.</p>
      </section>
      <section>
        <h2>Position du destinataire d&apos;un colis</h2>
        <p>
          L&apos;expéditeur peut envoyer au destinataire un lien pour partager sa position. Rien n&apos;est envoyé sans son accord, la position est prise
          une seule fois, et seuls le livreur et Zedeka la voient, pas l&apos;expéditeur. Le lien expire après 24 heures ou dès que le colis est
          récupéré. La position est effacée 30 jours après la livraison.
        </p>
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
