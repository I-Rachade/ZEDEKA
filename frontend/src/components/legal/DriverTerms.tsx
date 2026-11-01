import Link from "next/link";
import { COMPANY, MIN_AGE } from "@/lib/legal";

// i18n-ignore-file : texte juridique en français (langue officielle du Togo).
// Conditions livreurs : prestation de livraison par un livreur indépendant (les salariés relèvent de leur contrat de travail).
export default function DriverTerms() {
  return (
    <>
      <section>
        <h2>1. Statut</h2>
        <p>
          Le livreur qui postule par l&apos;application exerce comme prestataire indépendant (entreprenant ou entreprise immatriculée) et non comme salarié de {COMPANY.brand}. Il choisit
          librement ses heures de connexion, peut accepter ou refuser chaque course et travailler pour d&apos;autres plateformes. Il déclare et paie lui-même ses impôts et cotisations. Les
          livreurs salariés de Zedeka relèvent de leur contrat de travail, ces conditions s&apos;appliquant pour le reste.
        </p>
      </section>
      <section>
        <h2>2. Conditions à remplir</h2>
        <ul>
          <li>Avoir au moins {MIN_AGE} ans et disposer d&apos;une pièce d&apos;identité valide, présentée lors de la validation.</li>
          <li>Pour une moto ou une voiture : permis de conduire valide, carte grise, assurance responsabilité civile en cours de validité.</li>
          <li>Porter un casque homologué à moto, respecter le code de la route et ne jamais livrer sous l&apos;emprise d&apos;alcool ou de stupéfiants.</li>
        </ul>
      </section>
      <section>
        <h2>3. Courses</h2>
        <ul>
          <li>Une course acceptée doit être menée à son terme avec soin ; tout problème (client absent, colis douteux, accident) est signalé dans l&apos;application.</li>
          <li>Le livreur peut refuser un colis interdit ou suspect, et refuser de remettre de l&apos;alcool ou du tabac à un mineur.</li>
          <li>Il traite les clients et les partenaires avec respect et n&apos;utilise leurs coordonnées que pour la course en cours.</li>
        </ul>
      </section>
      <section>
        <h2>4. Rémunération</h2>
        <p>
          Pour chaque course livrée, le livreur indépendant reçoit la part des frais de livraison fixée par Zedeka et affichée dans l&apos;application avant l&apos;acceptation. Le détail des gains
          est consultable à tout moment.
        </p>
      </section>
      <section>
        <h2>5. Espèces encaissées</h2>
        <p>
          Les espèces reçues des clients appartiennent à Zedeka et aux partenaires. Le livreur les déclare à chaque remise et les reverse à Zedeka selon les modalités communiquées par la
          répartition. Tout écart non justifié peut être retenu sur ses gains.
        </p>
      </section>
      <section>
        <h2>6. Localisation et données</h2>
        <p>
          Pendant une course, l&apos;application transmet la position du livreur toutes les 30 secondes pour informer le client et la répartition. Elle n&apos;est pas suivie en dehors des courses.
          Les positions sont effacées après 90 jours. Voir la <Link href="/confidentialite">politique de confidentialité</Link> ; pour effacer vos données, voir{" "}
          <Link href="/suppression-donnees">Supprimer mes données</Link>.
        </p>
      </section>
      <section>
        <h2>7. Suspension et fin</h2>
        <p>
          Le livreur peut cesser à tout moment. Zedeka peut suspendre un compte en cas de manquement (espèces non reversées, comportement dangereux, plaintes répétées) après l&apos;avoir entendu,
          sauf urgence.
        </p>
      </section>
      <section>
        <h2>8. Droit applicable</h2>
        <p>Ces conditions sont soumises au droit togolais. À défaut d&apos;accord amiable, les litiges relèvent des juridictions compétentes de Lomé.</p>
      </section>
    </>
  );
}
