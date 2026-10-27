import { COMPANY, LEGAL_UPDATED } from "@/lib/legal";

// Politique de confidentialité (loi n° 2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel).
export default function Privacy() {
  return (
    <>
      <p className="text-sm text-stone-500">Version du {LEGAL_UPDATED}</p>
      <section>
        <h2>Responsable du traitement</h2>
        <p>
          {COMPANY.legalName} ({COMPANY.brand}), {COMPANY.address}. Contact pour vos données : {COMPANY.email}. Les traitements sont déclarés à l&apos;Instance de Protection des Données à Caractère
          Personnel (IPDCP), récépissé n° {COMPANY.ipdcpReceipt}.
        </p>
      </section>
      <section>
        <h2>Données collectées</h2>
        <ul>
          <li>Clients : nom, numéro de téléphone, adresses (quartier, repère, position si vous la partagez), commandes, montants et mode de paiement.</li>
          <li>Destinataires de colis : nom, numéro et adresse indiqués par l&apos;expéditeur.</li>
          <li>Livreurs : nom, numéro, véhicule, zone, position pendant les courses, espèces encaissées et gains.</li>
          <li>Partenaires : identité du gérant, coordonnées, pièces du dossier (RCCM, pièce d&apos;identité, photos), coordonnées de reversement.</li>
          <li>Techniques : session de connexion, abonnements aux notifications.</li>
        </ul>
        <p>Nous ne collectons aucune donnée sensible (santé, religion, biométrie…) et aucun code secret mobile money.</p>
      </section>
      <section>
        <h2>Finalités et bases légales</h2>
        <ul>
          <li>Exécuter les commandes, livraisons et réservations, et vous contacter à leur sujet : exécution du contrat.</li>
          <li>Tenir la comptabilité, facturer et reverser aux partenaires : obligation légale (droit comptable OHADA et fiscal).</li>
          <li>Prévenir la fraude, sécuriser les comptes et traiter les réclamations : intérêt légitime de Zedeka.</li>
          <li>Utiliser votre position et vous envoyer des notifications : votre consentement, que vous pouvez retirer à tout moment dans les réglages du téléphone.</li>
        </ul>
        <p>Nous n&apos;envoyons pas de messages publicitaires sans votre accord préalable.</p>
      </section>
      <section>
        <h2>Destinataires</h2>
        <ul>
          <li>Le restaurant, le commerce ou le loueur concerné et le livreur voient le nom, le numéro et l&apos;adresse nécessaires à la commande.</li>
          <li>Nos prestataires techniques (hébergement, envoi de SMS ou WhatsApp, opérateurs mobile money) agissent sur nos instructions et sont tenus à la confidentialité.</li>
          <li>Les autorités, sur réquisition légale.</li>
        </ul>
        <p>Nous ne vendons ni ne louons vos données.</p>
      </section>
      <section>
        <h2>Transferts hors du Togo</h2>
        <p>
          Si un prestataire héberge des données hors du Togo, le transfert n&apos;a lieu que vers un pays assurant un niveau de protection suffisant ou avec les garanties et autorisations exigées par
          la loi n° 2019-014 et l&apos;IPDCP.
        </p>
      </section>
      <section>
        <h2>Durées de conservation</h2>
        <ul>
          <li>Compte client : jusqu&apos;à sa suppression ; à la suppression, adresses effacées et commandes détachées de votre numéro.</li>
          <li>Commandes et pièces comptables : 10 ans (Acte uniforme OHADA relatif au droit comptable).</li>
          <li>Codes de connexion : supprimés 24 heures après leur création.</li>
          <li>Positions des livreurs : 90 jours, pour le suivi et le traitement des réclamations.</li>
          <li>Dossiers de candidature refusés : 1 an, puis supprimés.</li>
        </ul>
      </section>
      <section>
        <h2>Sécurité</h2>
        <p>
          Connexions chiffrées (HTTPS), codes à usage unique limités dans le temps et en nombre d&apos;essais, mots de passe des partenaires chiffrés, accès aux données limité aux personnes qui en
          ont besoin. En cas de violation de données présentant un risque, nous informons l&apos;IPDCP et les personnes concernées.
        </p>
      </section>
      <section>
        <h2>Sur votre téléphone</h2>
        <p>
          Le panier, l&apos;adresse choisie et la session sont gardés dans le stockage local de votre navigateur, sans cookie publicitaire ni traceur tiers. Se déconnecter efface la session.
        </p>
      </section>
      <section>
        <h2>Vos droits</h2>
        <p>
          Vous disposez d&apos;un droit d&apos;information, d&apos;accès, de rectification, d&apos;effacement et d&apos;opposition pour motif légitime. Écrivez à {COMPANY.email} ou sur WhatsApp en
          indiquant votre numéro ; nous répondons dans un délai d&apos;un mois. Vous pouvez aussi supprimer votre compte depuis votre profil. Si la réponse ne vous satisfait pas, vous pouvez saisir
          l&apos;IPDCP.
        </p>
      </section>
    </>
  );
}
