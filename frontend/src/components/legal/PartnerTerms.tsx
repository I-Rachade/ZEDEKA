import Link from "next/link";
import { COMPANY } from "@/lib/legal";

// i18n-ignore-file : texte juridique en français (langue officielle du Togo).
// Conditions partenaires : restaurants et commerces.
export default function PartnerTerms() {
  return (
    <>
      <section>
        <h2>1. Objet</h2>
        <p>
          Ces conditions régissent la relation entre {COMPANY.legalName} ({COMPANY.brand}) et les restaurants et commerces qui vendent par la plateforme. Elles sont acceptées lors de la
          candidature et s&apos;appliquent dès la validation du compte.
        </p>
      </section>
      <section>
        <h2>2. Conditions pour devenir partenaire</h2>
        <ul>
          <li>Exercer légalement au Togo : immatriculation au RCCM ou statut d&apos;entreprenant, NIF, autorisations propres à l&apos;activité.</li>
          <li>Restaurants : respecter les règles d&apos;hygiène et de sécurité alimentaire applicables.</li>
          <li>Fournir des informations exactes et signaler tout changement (gérant, adresse, numéro de reversement).</li>
        </ul>
      </section>
      <section>
        <h2>3. Carte, prix et commandes</h2>
        <ul>
          <li>Le partenaire fixe ses prix, toutes taxes comprises, et garantit l&apos;exactitude des descriptions, photos et allergènes affichés.</li>
          <li>Aucun frais caché : le prix affiché sur Zedeka est celui facturé au client, sans supplément ajouté à la livraison.</li>
          <li>Il accepte ou refuse chaque commande sans délai, tient sa carte et ses horaires à jour et ferme temporairement en cas d&apos;indisponibilité.</li>
          <li>Il prépare les commandes avec soin, dans un emballage adapté au transport, et ne vend pas d&apos;alcool ou de tabac à un mineur.</li>
          <li>Il reste seul responsable de la qualité, de la conformité et de la sécurité des produits fournis.</li>
        </ul>
      </section>
      <section>
        <h2>4. Photos, logos et textes</h2>
        <p>
          Le partenaire garantit détenir les droits sur les photos, logos et textes qu&apos;il envoie (photos prises par lui, ou images sous licence l&apos;autorisant), qu&apos;ils représentent
          fidèlement ses produits, et autorise Zedeka à les afficher sur le site et les applications pendant la durée du contrat. Zedeka retire tout contenu signalé comme portant atteinte aux
          droits d&apos;un tiers. Il est interdit de publier de faux avis ou des allégations non vérifiables (« le meilleur de Lomé », « 100 % bio »…).
        </p>
      </section>
      <section>
        <h2>5. Rémunération de Zedeka</h2>
        <ul>
          <li>Selon la formule choisie à la candidature : abonnement mensuel au prix affiché, ou commission sur le montant des ventes. Le changement de formule prend effet le mois suivant.</li>
          <li>Les frais de livraison payés par le client reviennent à Zedeka.</li>
          <li>Les montants sont exprimés en FCFA ; Zedeka émet une facture pour chaque période.</li>
        </ul>
      </section>
      <section>
        <h2>6. Encaissement et reversements</h2>
        <ul>
          <li>Le partenaire mandate Zedeka pour encaisser en son nom et pour son compte le prix des commandes payées par le client (espèces au livreur ou mobile money).</li>
          <li>Zedeka reverse les sommes encaissées, déduction faite de sa rémunération, sur le numéro mobile money déclaré, selon le relevé disponible dans l&apos;espace partenaire.</li>
          <li>Une commande annulée par la faute du partenaire (refus tardif, produit manquant) n&apos;est pas reversée ; le remboursement du client peut lui être imputé.</li>
        </ul>
      </section>
      <section>
        <h2>7. Données des clients</h2>
        <p>
          Le partenaire reçoit le nom, le numéro et le point de livraison des clients uniquement pour exécuter la commande. Il ne les utilise pas à d&apos;autres fins (prospection, revente), les
          garde confidentielles et respecte la loi n° 2019-014 relative à la protection des données à caractère personnel. Voir la <Link href="/confidentialite">politique de confidentialité</Link>.
        </p>
      </section>
      <section>
        <h2>8. Compte et sécurité</h2>
        <p>Les identifiants de l&apos;espace partenaire sont personnels. Le partenaire répond des actions faites avec son compte et signale sans délai toute perte ou utilisation suspecte.</p>
      </section>
      <section>
        <h2>9. Durée, suspension et résiliation</h2>
        <ul>
          <li>Le contrat est conclu pour une durée indéterminée. Chaque partie peut y mettre fin par écrit avec un préavis de 15 jours.</li>
          <li>Zedeka peut suspendre un compte sans préavis en cas de manquement grave (hygiène, fraude, plaintes répétées, informations fausses).</li>
          <li>Les sommes dues sont réglées à la fin du contrat.</li>
        </ul>
      </section>
      <section>
        <h2>10. Droit applicable</h2>
        <p>
          Ces conditions sont soumises au droit togolais et à l&apos;Acte uniforme OHADA relatif au droit commercial général. À défaut d&apos;accord amiable, les litiges relèvent du tribunal de
          commerce de Lomé.
        </p>
      </section>
    </>
  );
}
