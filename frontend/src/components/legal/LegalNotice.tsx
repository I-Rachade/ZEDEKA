import Link from "next/link";
import { COMPANY } from "@/lib/legal";

// i18n-ignore-file : texte juridique en français (langue officielle du Togo).
// Mentions légales : identification de l'exploitant (loi n° 2017-07 relative aux transactions électroniques, AUDCG OHADA).
export default function LegalNotice() {
  return (
    <>
      <section>
        <h2>Éditeur du site et des applications</h2>
        <ul>
          <li>{COMPANY.brand}</li>
          <li>{COMPANY.city}</li>
          <li>Contact : WhatsApp, par le bouton « Aide » du site et de l&apos;application</li>
        </ul>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>{COMPANY.host}</p>
      </section>
      <section>
        <h2>Données personnelles</h2>
        <p>
          Les traitements de données réalisés par {COMPANY.brand} relèvent de la loi n° 2019-014 du 29 octobre 2019 relative à la protection des données à caractère personnel, sous le contrôle de
          l&apos;Instance de Protection des Données à Caractère Personnel (IPDCP). Le détail figure dans la <Link href="/confidentialite">politique de confidentialité</Link> ; pour effacer vos données, voir{" "}
          <Link href="/suppression-donnees">Supprimer mes données</Link>.
        </p>
      </section>
      <section>
        <h2>Rôle de Zedeka</h2>
        <p>
          {COMPANY.brand} est une plateforme d&apos;intermédiation : elle transmet les commandes aux restaurants et commerces partenaires et organise leur livraison, ainsi que celle des colis, par
          des livreurs. Les plats et produits sont préparés et fournis par les partenaires, sous leur responsabilité.
        </p>
      </section>
      <section>
        <h2>Propriété intellectuelle et images</h2>
        <p>
          La marque, le logo et les contenus propres du site appartiennent à {COMPANY.brand}. Toute reproduction sans autorisation est interdite. Le site n&apos;utilise pas de banque
          d&apos;images : les photos des plats et les logos sont fournis par les restaurants, qui garantissent en détenir les droits (voir les{" "}
          <Link href="/conditions-partenaires">conditions partenaires</Link>). Pour signaler un contenu qui porte atteinte à vos droits, écrivez-nous sur WhatsApp.
        </p>
      </section>
      <section>
        <h2>Droit applicable</h2>
        <p>
          Le site et les applications sont soumis au droit togolais et aux Actes uniformes de l&apos;OHADA. À défaut d&apos;accord amiable, les litiges relèvent des juridictions compétentes de Lomé,
          sans préjudice des droits que le consommateur tient de la loi.
        </p>
      </section>
    </>
  );
}
