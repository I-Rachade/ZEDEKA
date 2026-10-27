import { COMPANY, LEGAL_UPDATED } from "@/lib/legal";

// Conditions partenaires : restaurants, commerces et loueurs de véhicules.
export default function PartnerTerms() {
  return (
    <>
      <p className="text-sm text-stone-500">Version du {LEGAL_UPDATED}</p>
      <section>
        <h2>1. Objet</h2>
        <p>
          Ces conditions régissent la relation entre {COMPANY.legalName} ({COMPANY.brand}) et les commerces (restaurants, boutiques) et loueurs de véhicules qui vendent par la plateforme. Elles
          sont acceptées lors de la candidature et s&apos;appliquent dès la validation du compte.
        </p>
      </section>
      <section>
        <h2>2. Conditions pour devenir partenaire</h2>
        <ul>
          <li>Exercer légalement au Togo : immatriculation au RCCM ou statut d&apos;entreprenant, NIF, autorisations propres à l&apos;activité.</li>
          <li>Restaurants : respecter les règles d&apos;hygiène et de sécurité alimentaire applicables.</li>
          <li>Loueurs : véhicules immatriculés, assurés (assurance responsabilité civile automobile obligatoire), visite technique à jour ; chauffeurs titulaires du permis requis.</li>
          <li>Fournir des informations exactes et signaler tout changement (gérant, adresse, numéro de reversement).</li>
        </ul>
      </section>
      <section>
        <h2>3. Carte, prix et commandes</h2>
        <ul>
          <li>Le partenaire fixe ses prix, toutes taxes comprises, et garantit l&apos;exactitude des descriptions, photos et allergènes affichés.</li>
          <li>Il accepte ou refuse chaque commande sans délai, tient sa carte et ses horaires à jour et ferme temporairement en cas d&apos;indisponibilité.</li>
          <li>Il prépare les commandes avec soin, dans un emballage adapté au transport, et ne vend pas d&apos;alcool ou de tabac à un mineur.</li>
          <li>Il reste seul responsable de la qualité, de la conformité et de la sécurité des produits et des véhicules fournis.</li>
        </ul>
      </section>
      <section>
        <h2>4. Rémunération de Zedeka</h2>
        <ul>
          <li>Selon la formule choisie à la candidature : abonnement mensuel au prix affiché, ou commission sur le montant des ventes. Le changement de formule prend effet le mois suivant.</li>
          <li>Les frais de livraison payés par le client reviennent à Zedeka.</li>
          <li>Les montants sont exprimés en FCFA, hors taxes s&apos;il y a lieu ; Zedeka émet une facture pour chaque période.</li>
        </ul>
      </section>
      <section>
        <h2>5. Encaissement et reversements</h2>
        <ul>
          <li>Le partenaire mandate Zedeka pour encaisser en son nom et pour son compte le prix des commandes payées par le client (espèces au livreur ou mobile money).</li>
          <li>Zedeka reverse les sommes encaissées, déduction faite de sa rémunération, sur le numéro mobile money déclaré, selon le relevé disponible dans l&apos;espace partenaire.</li>
          <li>Une commande annulée par la faute du partenaire (refus tardif, produit manquant) n&apos;est pas reversée ; le remboursement du client peut lui être imputé.</li>
        </ul>
      </section>
      <section>
        <h2>6. Données des clients</h2>
        <p>
          Le partenaire reçoit le nom, le numéro et l&apos;adresse des clients uniquement pour exécuter la commande. Il ne les utilise pas à d&apos;autres fins (prospection, revente), les garde
          confidentielles et respecte la loi n° 2019-014 relative à la protection des données à caractère personnel.
        </p>
      </section>
      <section>
        <h2>7. Compte et sécurité</h2>
        <p>Les identifiants de l&apos;espace partenaire sont personnels. Le partenaire répond des actions faites avec son compte et signale sans délai toute perte ou utilisation suspecte.</p>
      </section>
      <section>
        <h2>8. Durée, suspension et résiliation</h2>
        <ul>
          <li>Le contrat est conclu pour une durée indéterminée. Chaque partie peut y mettre fin par écrit avec un préavis de 15 jours.</li>
          <li>Zedeka peut suspendre un compte sans préavis en cas de manquement grave (hygiène, fraude, plaintes répétées, informations fausses).</li>
          <li>Les sommes dues sont réglées à la fin du contrat.</li>
        </ul>
      </section>
      <section>
        <h2>9. Droit applicable</h2>
        <p>
          Ces conditions sont soumises au droit togolais et à l&apos;Acte uniforme OHADA relatif au droit commercial général. À défaut d&apos;accord amiable, les litiges relèvent du tribunal de
          commerce de Lomé.
        </p>
      </section>
    </>
  );
}
