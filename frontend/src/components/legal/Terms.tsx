import Link from "next/link";
import { COMPANY, MIN_AGE } from "@/lib/legal";

// i18n-ignore-file : texte juridique en français (langue officielle du Togo).
// Conditions générales d'utilisation et de vente pour les clients (repas et colis).
export default function Terms() {
  return (
    <>
      <section>
        <h2>1. Objet</h2>
        <p>
          Les présentes conditions régissent l&apos;utilisation du site, de l&apos;application {COMPANY.brand} et les commandes passées par leur intermédiaire. {COMPANY.brand} est exploitée par{" "}
          {COMPANY.legalName}, {COMPANY.form}, RCCM {COMPANY.rccm} (voir les <Link href="/mentions-legales">mentions légales</Link>). En cochant la case prévue avant de commander ou de créer un
          compte, vous acceptez ces conditions dans leur version en vigueur à ce moment.
        </p>
      </section>
      <section>
        <h2>2. Rôle de Zedeka</h2>
        <ul>
          <li>Repas : la commande est transmise au restaurant, qui prépare les plats sous sa responsabilité (hygiène, composition, allergènes). Zedeka organise la livraison.</li>
          <li>Colis : Zedeka assure l&apos;enlèvement et la remise du colis par un livreur.</li>
          <li>Les livreurs sont des prestataires indépendants sélectionnés par Zedeka ou des salariés de Zedeka.</li>
        </ul>
      </section>
      <section>
        <h2>3. Âge et compte</h2>
        <ul>
          <li>
            Les services sont réservés aux personnes âgées d&apos;au moins {MIN_AGE} ans. Une personne plus jeune doit passer par un parent ou un tuteur, qui commande en son nom. Si nous
            apprenons qu&apos;un compte a été créé par un mineur sans cet accord, nous le supprimons.
          </li>
          <li>Le compte est facultatif. Il est lié à votre numéro de téléphone, vérifié par un code à usage unique, puis protégé par un code PIN que vous gardez secret.</li>
          <li>Vous êtes responsable de l&apos;exactitude des informations données (nom, numéro, point de livraison, repère).</li>
          <li>
            Vous pouvez supprimer votre compte à tout moment depuis votre profil, ou demander l&apos;effacement de vos données (<Link href="/suppression-donnees">Supprimer mes données</Link>).
          </li>
        </ul>
      </section>
      <section>
        <h2>4. Prix et frais</h2>
        <ul>
          <li>Les prix sont affichés en francs CFA (FCFA), toutes taxes comprises. Les prix des plats sont fixés par les restaurants.</li>
          <li>
            Les seuls montants facturés sont le prix des plats ou du colis et les frais de livraison, calculés selon la distance (ou la zone) et affichés avant la validation. Il n&apos;y a ni
            frais de service, ni frais de dossier, ni montant ajouté après coup.
          </li>
          <li>
            Des frais ne s&apos;appliquent qu&apos;en cas d&apos;annulation tardive, selon la <Link href="/remboursement">politique d&apos;annulation et de remboursement</Link>, rappelée avant la
            commande.
          </li>
          <li>Le total est recalculé par Zedeka au moment de la commande ; c&apos;est ce total, affiché avant confirmation, qui vous engage.</li>
        </ul>
      </section>
      <section>
        <h2>5. Commande</h2>
        <ul>
          <li>La commande est conclue lorsque vous la confirmez ; vous recevez aussitôt un code de suivi qui en fait foi.</li>
          <li>
            Le restaurant peut refuser ou modifier une commande (rupture, fermeture, minimum non atteint). Vous en êtes informé ; toute hausse du prix demande votre accord, et vous pouvez alors
            annuler sans frais.
          </li>
          <li>La vente d&apos;alcool et de tabac aux mineurs est interdite ; le livreur peut demander une pièce d&apos;identité et refuser la remise.</li>
        </ul>
      </section>
      <section>
        <h2>6. Paiement</h2>
        <ul>
          <li>En espèces à la livraison, ou par mobile money (T-Money, Flooz) lorsque ce mode est proposé. Zedeka ne vous demande jamais votre code secret mobile money.</li>
          <li>Pour les repas, Zedeka encaisse le prix au nom et pour le compte du restaurant, et les frais de livraison pour son propre compte.</li>
          <li>Un reçu est disponible sur simple demande.</li>
        </ul>
      </section>
      <section>
        <h2>7. Livraison</h2>
        <ul>
          <li>
            Les délais affichés sont des estimations du restaurant et non des garanties. Le livreur vous appelle à son arrivée ; s&apos;il ne peut vous joindre après plusieurs essais, la
            commande peut être annulée avec retenue des frais de livraison.
          </li>
          <li>
            Colis : sont interdits les objets illicites, dangereux ou inflammables, les armes, les stupéfiants, les espèces, les bijoux et les animaux vivants. Le livreur peut refuser un colis.
          </li>
          <li>
            Colis : en cas de perte ou de dommage imputable à Zedeka, l&apos;indemnisation est limitée à la valeur du contenu justifiée, dans la limite de 50 000 FCFA par colis, sauf faute
            lourde.
          </li>
        </ul>
      </section>
      <section>
        <h2>8. Annulation, rétractation et remboursement</h2>
        <p>
          Les règles sont détaillées dans la <Link href="/remboursement">politique d&apos;annulation et de remboursement</Link>. Les repas sont des denrées périssables préparées à la demande :
          une fois la préparation commencée, la commande ne peut plus être annulée ni faire l&apos;objet d&apos;un droit de rétractation.
        </p>
      </section>
      <section>
        <h2>9. Réclamations</h2>
        <p>
          Signalez tout problème (plat manquant ou abîmé, retard, colis endommagé) dans les 24 heures suivant la livraison, avec le code de la commande et si possible une photo, sur WhatsApp ou
          à {COMPANY.email}. Zedeka traite la réclamation avec le partenaire et vous répond.
        </p>
      </section>
      <section>
        <h2>10. Responsabilité</h2>
        <p>
          Zedeka répond de la bonne exécution de la livraison. Le restaurant répond de la qualité et de la conformité des plats. Zedeka n&apos;est pas responsable d&apos;un retard ou d&apos;une
          impossibilité dus à un cas de force majeure, à une adresse erronée ou à l&apos;absence du client.
        </p>
      </section>
      <section>
        <h2>11. Données personnelles</h2>
        <p>
          Vos données sont traitées selon la loi n° 2019-014 relative à la protection des données à caractère personnel : voir la{" "}
          <Link href="/confidentialite">politique de confidentialité</Link> et la <Link href="/cookies">politique relative aux cookies</Link>.
        </p>
      </section>
      <section>
        <h2>12. Preuve et modification</h2>
        <p>
          Les enregistrements électroniques de Zedeka (commandes, heure d&apos;acceptation des conditions, échanges) font preuve des transactions, conformément à la loi n° 2017-07 relative aux
          transactions électroniques. Zedeka peut modifier ces conditions ; la version applicable est celle acceptée lors de la commande.
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
