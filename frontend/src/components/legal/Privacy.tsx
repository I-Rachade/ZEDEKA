import Link from "next/link";
import { COMPANY } from "@/lib/legal";

// i18n-ignore-file : texte juridique en français (langue officielle du Togo).
// Politique de confidentialité (loi n° 2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel).
// À tenir à jour avec le code : durées de backend/src/retention.ts, prestataires réellement branchés.
export default function Privacy() {
  return (
    <>
      <section>
        <h2>Responsable du traitement</h2>
        <p>
          {COMPANY.legalName} ({COMPANY.brand}), {COMPANY.address}. Contact pour vos données : {COMPANY.email}. Les traitements sont déclarés à l&apos;Instance de Protection des Données à Caractère
          Personnel (IPDCP), récépissé n° {COMPANY.ipdcpReceipt}.
        </p>
      </section>
      <section>
        <h2>Données collectées, et seulement celles-ci</h2>
        <ul>
          <li>Clients : nom, numéro de téléphone, e-mail si vous le donnez, point de livraison et repère, commandes, montants et mode de paiement.</li>
          <li>Destinataires de colis : nom, numéro et point de livraison indiqués par l&apos;expéditeur ; la position du destinataire seulement s&apos;il accepte de la partager.</li>
          <li>Livreurs : nom, numéro, e-mail facultatif, véhicule, zone, position pendant les courses, espèces encaissées et gains.</li>
          <li>Partenaires : identité du gérant, coordonnées, pièces du dossier (RCCM, NIF, pièce justificative, logo et photos), numéro mobile money de reversement.</li>
          <li>Techniques : session de connexion, abonnements aux notifications, langue choisie.</li>
        </ul>
        <p>
          Nous ne demandons ni date de naissance, ni pièce d&apos;identité aux clients, ni aucune donnée sensible (santé, religion, biométrie…). Nous ne recevons jamais votre code secret mobile
          money. Les champs facultatifs sont signalés comme tels.
        </p>
      </section>
      <section>
        <h2>Finalités et bases légales</h2>
        <ul>
          <li>Exécuter les commandes et livraisons, et vous contacter à leur sujet : exécution du contrat.</li>
          <li>Tenir la comptabilité, facturer et reverser aux partenaires : obligation légale (droit comptable OHADA et fiscal).</li>
          <li>Prévenir la fraude, sécuriser les comptes et traiter les réclamations : intérêt légitime de Zedeka.</li>
          <li>Utiliser votre position et vous envoyer des notifications : votre consentement, demandé par le téléphone et retirable à tout moment dans ses réglages.</li>
        </ul>
        <p>Nous n&apos;envoyons ni publicité ni lettre d&apos;information. Les seuls e-mails et SMS sont des codes de connexion demandés par vous.</p>
      </section>
      <section>
        <h2>Destinataires</h2>
        <ul>
          <li>Le restaurant concerné et le livreur voient le nom, le numéro et le point de livraison nécessaires à la commande.</li>
          <li>Les prestataires techniques listés ci-dessous, sur nos instructions et tenus à la confidentialité.</li>
          <li>Les autorités, sur réquisition légale.</li>
        </ul>
        <p>Nous ne vendons ni ne louons vos données, et n&apos;utilisons aucun outil publicitaire ni de mesure d&apos;audience.</p>
      </section>
      <section>
        <h2>Prestataires techniques</h2>
        <ul>
          <li>Cloudflare (États-Unis, centres de données dans le monde) : hébergement du site, de la base de données et des fichiers, envoi des e-mails.</li>
          <li>OpenStreetMap Foundation (Royaume-Uni) : fonds de carte. Votre navigateur les télécharge directement, ce qui transmet votre adresse IP, mais aucune donnée de compte.</li>
          <li>Didit (vérification du numéro par SMS), lorsqu&apos;il est activé : numéro de téléphone et code.</li>
          <li>Google Firebase Cloud Messaging et les services de notification d&apos;Apple, Google et Mozilla : acheminement des notifications si vous les autorisez.</li>
          <li>WhatsApp (Meta) : seulement si vous choisissez de nous écrire ou de confirmer une commande par WhatsApp.</li>
        </ul>
      </section>
      <section>
        <h2>Transferts hors du Togo</h2>
        <p>
          Certains de ces prestataires traitent des données hors du Togo. Ces transferts sont limités à ce qui est nécessaire au service et réalisés avec les garanties prévues par la loi n°
          2019-014 et les décisions de l&apos;IPDCP.
        </p>
      </section>
      <section>
        <h2>Durées de conservation</h2>
        <ul>
          <li>Compte client : jusqu&apos;à sa suppression ; à la suppression, adresses effacées et commandes détachées de votre numéro.</li>
          <li>Commandes et pièces comptables : 10 ans (Acte uniforme OHADA relatif au droit comptable).</li>
          <li>Codes de connexion et de PIN oublié : effacés automatiquement 24 heures après leur création.</li>
          <li>Position partagée par un destinataire : effacée 30 jours après la livraison.</li>
          <li>Positions des livreurs : effacées automatiquement après 90 jours.</li>
          <li>Candidatures refusées (commerces, et livreurs sans aucune course) : effacées automatiquement un an après le refus.</li>
        </ul>
      </section>
      <section>
        <h2>Enfants</h2>
        <p>
          Nous ne demandons pas l&apos;âge et ne cherchons pas à collecter de données sur les enfants. Un parent qui souhaite faire effacer les données de son enfant peut nous écrire ou
          passer par <Link href="/suppression-donnees">Supprimer mes données</Link> : nous les effaçons.
        </p>
      </section>
      <section>
        <h2>Sécurité</h2>
        <p>
          Connexions chiffrées (HTTPS), codes à usage unique limités dans le temps et en nombre d&apos;essais, codes PIN et mots de passe enregistrés sous forme hachée (illisibles), accès aux données limité aux
          personnes qui en ont besoin. En cas de violation de données présentant un risque, nous informons l&apos;IPDCP et les personnes concernées.
        </p>
      </section>
      <section>
        <h2>Sur votre téléphone</h2>
        <p>
          Le panier, le point de livraison choisi, la langue et la session sont gardés sur votre appareil. Le détail est dans la <Link href="/cookies">politique relative aux cookies</Link>.
        </p>
      </section>
      <section>
        <h2>Vos droits</h2>
        <p>
          Vous disposez d&apos;un droit d&apos;information, d&apos;accès, de rectification, d&apos;effacement et d&apos;opposition pour motif légitime. Clients : « Supprimer mon compte » dans le
          profil efface vos adresses et détache vos commandes de votre numéro. Pour toute autre demande (livreurs, partenaires, destinataires, commandes sans compte), passez par{" "}
          <Link href="/suppression-donnees">Supprimer mes données</Link> ou écrivez à {COMPANY.email}. Nous répondons dans un délai d&apos;un mois. Si la réponse ne vous satisfait pas, vous
          pouvez saisir l&apos;IPDCP.
        </p>
      </section>
    </>
  );
}
