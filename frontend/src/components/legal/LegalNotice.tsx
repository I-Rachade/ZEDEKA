import { COMPANY, LEGAL_UPDATED } from "@/lib/legal";

// Mentions légales : identification de l'exploitant (loi n° 2017-07 relative aux transactions électroniques, AUDCG OHADA).
export default function LegalNotice() {
  return (
    <>
      <p className="text-sm text-stone-500">Version du {LEGAL_UPDATED}</p>
      <section>
        <h2>Éditeur du site et des applications</h2>
        <ul>
          <li>
            {COMPANY.legalName}, exploitant la marque {COMPANY.brand}
          </li>
          <li>{COMPANY.form} au capital de {COMPANY.capital}, régie par l&apos;Acte uniforme OHADA relatif au droit des sociétés commerciales</li>
          <li>Immatriculée au Registre du Commerce et du Crédit Mobilier (RCCM) de Lomé sous le n° {COMPANY.rccm}</li>
          <li>Numéro d&apos;identification fiscale (NIF) : {COMPANY.nif}</li>
          <li>Siège social : {COMPANY.address}</li>
          <li>Directeur de la publication : {COMPANY.manager}</li>
          <li>
            Contact : {COMPANY.email} · {COMPANY.phone}
          </li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>{COMPANY.host}</p>
      </section>
      <section>
        <h2>Données personnelles</h2>
        <p>
          Les traitements de données réalisés par {COMPANY.brand} sont déclarés à l&apos;Instance de Protection des Données à Caractère Personnel (IPDCP) conformément à la loi n° 2019-014 du 29 octobre
          2019 (récépissé n° {COMPANY.ipdcpReceipt}). Le détail figure dans la <a href="/confidentialite">politique de confidentialité</a>.
        </p>
      </section>
      <section>
        <h2>Rôle de Zedeka</h2>
        <p>
          {COMPANY.brand} est une plateforme d&apos;intermédiation : elle transmet les commandes aux restaurants et commerces partenaires, organise la livraison par des livreurs indépendants et met en
          relation les clients avec des loueurs de véhicules. Les plats, produits et véhicules sont fournis par les partenaires, sous leur responsabilité.
        </p>
      </section>
      <section>
        <h2>Propriété intellectuelle</h2>
        <p>
          La marque, le logo et les contenus du site appartiennent à {COMPANY.legalName} ou à ses partenaires. Toute reproduction sans autorisation est interdite. Les photos et descriptions des plats
          sont fournies par les restaurants.
        </p>
      </section>
      <section>
        <h2>Droit applicable</h2>
        <p>
          Le site et les applications sont soumis au droit togolais et aux Actes uniformes de l&apos;OHADA. À défaut d&apos;accord amiable, les litiges relèvent des juridictions compétentes de Lomé, sans
          préjudice des droits que le consommateur tient de la loi.
        </p>
      </section>
    </>
  );
}
