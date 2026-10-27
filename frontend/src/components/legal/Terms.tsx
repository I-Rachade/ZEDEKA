import { COMPANY, LEGAL_UPDATED } from "@/lib/legal";

// Conditions générales d'utilisation et de vente pour les clients (repas, colis, location).
export default function Terms() {
  return (
    <>
      <p className="text-sm text-stone-500">Version du {LEGAL_UPDATED}</p>
      <section>
        <h2>1. Objet</h2>
        <p>
          Les présentes conditions régissent l&apos;utilisation du site, de l&apos;application {COMPANY.brand} et les commandes passées par leur intermédiaire. {COMPANY.brand} est exploitée par{" "}
          {COMPANY.legalName}, {COMPANY.form}, RCCM {COMPANY.rccm} (voir les <a href="/mentions-legales">mentions légales</a>). Passer une commande ou créer un compte vaut acceptation de ces
          conditions, dans leur version en vigueur au jour de la commande.
        </p>
      </section>
      <section>
        <h2>2. Rôle de Zedeka</h2>
        <ul>
          <li>Repas : la commande est transmise au restaurant, qui prépare les plats sous sa responsabilité (hygiène, composition, allergènes). Zedeka organise la livraison.</li>
          <li>Colis : Zedeka assure l&apos;enlèvement et la remise du colis par un livreur.</li>
          <li>Location : Zedeka transmet la réservation au loueur, qui fournit le véhicule et, le cas échéant, le chauffeur, sous sa responsabilité.</li>
          <li>Les livreurs sont des prestataires indépendants sélectionnés par Zedeka.</li>
        </ul>
      </section>
      <section>
        <h2>3. Compte</h2>
        <ul>
          <li>Le compte est facultatif. Il est lié à votre numéro de téléphone, vérifié par un code à usage unique.</li>
          <li>Vous êtes responsable de l&apos;exactitude des informations données (nom, numéro, adresse, repère).</li>
          <li>Vous pouvez supprimer votre compte à tout moment depuis votre profil.</li>
          <li>Les services sont réservés aux personnes capables de contracter ; un mineur doit passer par un parent ou tuteur.</li>
        </ul>
      </section>
      <section>
        <h2>4. Prix</h2>
        <ul>
          <li>Les prix sont affichés en francs CFA (FCFA), toutes taxes comprises. Les prix des plats et des véhicules sont fixés par les partenaires.</li>
          <li>Les frais de livraison dépendent de la zone et parfois de la distance ; ils sont indiqués avant la validation.</li>
          <li>Le total est recalculé par Zedeka au moment de la commande ; c&apos;est ce total, affiché avant confirmation, qui vous engage.</li>
        </ul>
      </section>
      <section>
        <h2>5. Commande</h2>
        <ul>
          <li>La commande est conclue lorsque vous la confirmez ; vous recevez aussitôt un code de suivi qui en fait foi.</li>
          <li>Le partenaire peut refuser ou modifier une commande (rupture, fermeture, minimum non atteint). Vous en êtes informé ; toute hausse du prix nécessite votre accord.</li>
          <li>La vente d&apos;alcool et de tabac est interdite aux mineurs ; le livreur peut demander une pièce d&apos;identité et refuser la remise.</li>
        </ul>
      </section>
      <section>
        <h2>6. Paiement</h2>
        <ul>
          <li>En espèces à la livraison, ou par mobile money (T-Money, Flooz) auprès des opérateurs agréés. Zedeka ne conserve aucun code secret de paiement.</li>
          <li>Pour les repas et les locations, Zedeka encaisse le prix au nom et pour le compte du partenaire, et les frais de livraison pour son propre compte.</li>
          <li>Un reçu ou une facture est disponible sur simple demande.</li>
        </ul>
      </section>
      <section>
        <h2>7. Livraison</h2>
        <ul>
          <li>Les délais affichés sont indicatifs. Le livreur vous appelle à son arrivée ; s&apos;il ne peut vous joindre après plusieurs essais, la commande peut être annulée avec retenue des frais.</li>
          <li>Colis : sont interdits les objets illicites, dangereux ou inflammables, les armes, les stupéfiants, les espèces, les bijoux et les animaux vivants. Le livreur peut refuser un colis.</li>
          <li>
            Colis : en cas de perte ou de dommage imputable à Zedeka, l&apos;indemnisation est limitée à la valeur du contenu justifiée, dans la limite de 50 000 FCFA par colis, sauf faute lourde.
          </li>
        </ul>
      </section>
      <section>
        <h2>8. Annulation, rétractation et remboursement</h2>
        <ul>
          <li>
            Les règles d&apos;annulation (délai gratuit, frais retenus ensuite) sont détaillées sur la page <a href="/app/annulation">Annulation et remboursement</a>.
          </li>
          <li>
            Les repas sont des denrées périssables préparées à la demande : une fois la préparation commencée, la commande ne peut plus être annulée ni faire l&apos;objet d&apos;un droit de
            rétractation.
          </li>
          <li>Un paiement mobile money est remboursé sur le même numéro sous 72 heures, déduction faite des frais éventuellement retenus.</li>
        </ul>
      </section>
      <section>
        <h2>9. Réclamations</h2>
        <p>
          Signalez tout problème (plat manquant ou abîmé, retard, colis endommagé) dans les 24 heures suivant la livraison, avec le code de la commande et si possible une photo, sur WhatsApp ou
          à {COMPANY.email}. Zedeka traite la réclamation avec le partenaire et vous répond dans les meilleurs délais.
        </p>
      </section>
      <section>
        <h2>10. Responsabilité</h2>
        <p>
          Zedeka répond de la bonne exécution de la livraison. Le restaurant répond de la qualité et de la conformité des plats, le loueur du véhicule et de son assurance. Zedeka n&apos;est pas
          responsable d&apos;un retard ou d&apos;une impossibilité dus à un cas de force majeure, à une adresse erronée ou à l&apos;absence du client.
        </p>
      </section>
      <section>
        <h2>11. Données personnelles</h2>
        <p>
          Vos données sont traitées selon la loi n° 2019-014 relative à la protection des données à caractère personnel ; voir la <a href="/confidentialite">politique de confidentialité</a>.
        </p>
      </section>
      <section>
        <h2>12. Preuve et modification</h2>
        <p>
          Les enregistrements électroniques de Zedeka (commandes, horodatages, échanges) font preuve des transactions, conformément à la loi n° 2017-07 relative aux transactions électroniques.
          Zedeka peut modifier ces conditions ; la version applicable est celle acceptée lors de la commande.
        </p>
      </section>
      <section>
        <h2>13. Droit applicable et litiges</h2>
        <p>
          Ces conditions sont soumises au droit togolais. En cas de litige, contactez d&apos;abord le service client pour une solution amiable ; à défaut, les juridictions compétentes de Lomé
          peuvent être saisies, sans préjudice des droits du consommateur.
        </p>
      </section>
    </>
  );
}
