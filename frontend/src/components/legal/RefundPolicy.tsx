import Link from "next/link";
import { fcfa } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { COMPANY } from "@/lib/legal";

// i18n-ignore-file : texte juridique rédigé dans chaque langue.
// Politique d'annulation et de remboursement. Délai gratuit et pourcentage retenu viennent des réglages (/api/policies),
// les mêmes que ceux appliqués par l'admin : la page ne promet rien que le code ne fait pas.
export default function RefundPolicy({ lang, minutes, percent }: { lang: Lang; minutes: number; percent: number }) {
  const example = fcfa(Math.round((1000 * percent) / 100));
  if (lang === "en") {
    return (
      <>
        <section>
          <h2>Cancelling an order</h2>
          <ul>
            <li>
              Free cancellation for <strong>{minutes} minutes</strong> after ordering.
            </li>
            <li>
              After that, <strong>{percent}%</strong> of the delivery fee (including any parcel weight supplement) is kept (for example {example} on a {fcfa(1000)} delivery). The price of the meals is never kept for a cancellation
              before preparation.
            </li>
            <li>Once the meal is being prepared or the parcel picked up, the order can no longer be cancelled.</li>
            <li>To cancel, message us on WhatsApp with the order code.</li>
          </ul>
        </section>
        <section>
          <h2>Full refund</h2>
          <ul>
            <li>Order refused or cancelled by the restaurant, or by Zedeka (no rider available, area not served).</li>
            <li>Price increase by the restaurant that you do not accept.</li>
            <li>Missing item, wrong order or meal unfit for consumption, reported within 24 hours with the order code and a photo if possible: the item concerned is refunded or replaced.</li>
            <li>Parcel lost or damaged through Zedeka&apos;s fault: compensation up to the justified value, within the limit set in the <Link href="/conditions">terms</Link>.</li>
          </ul>
        </section>
        <section>
          <h2>How you are refunded</h2>
          <p>
            A mobile money payment is refunded to the same number within 72 hours, minus any fees kept. A cash payment is refunded by mobile money to the number you give us, or deducted from your
            next order if you prefer. Requests: WhatsApp or {COMPANY.email}.
          </p>
        </section>
      </>
    );
  }
  return (
    <>
      <section>
        <h2>Annuler une commande</h2>
        <ul>
          <li>
            Annulation gratuite pendant les <strong>{minutes} minutes</strong> qui suivent la commande.
          </li>
          <li>
            Ensuite, <strong>{percent} %</strong> des frais de livraison (supplément de poids d&apos;un colis compris) sont retenus (par exemple {example} sur une livraison à {fcfa(1000)}). Le prix des plats n&apos;est jamais retenu pour
            une annulation avant la préparation.
          </li>
          <li>Une fois le repas en préparation ou le colis récupéré, la commande ne peut plus être annulée.</li>
          <li>Pour annuler, écrivez-nous sur WhatsApp avec le code de la commande.</li>
        </ul>
      </section>
      <section>
        <h2>Remboursement intégral</h2>
        <ul>
          <li>Commande refusée ou annulée par le restaurant, ou par Zedeka (aucun livreur disponible, zone non desservie).</li>
          <li>Hausse de prix proposée par le restaurant que vous n&apos;acceptez pas.</li>
          <li>
            Article manquant, commande erronée ou plat impropre à la consommation, signalé dans les 24 heures avec le code de la commande et si possible une photo : l&apos;article concerné est
            remboursé ou remplacé.
          </li>
          <li>Colis perdu ou endommagé par la faute de Zedeka : indemnisation à hauteur de la valeur justifiée, dans la limite prévue aux <Link href="/conditions">conditions générales</Link>.</li>
        </ul>
      </section>
      <section>
        <h2>Comment vous êtes remboursé</h2>
        <p>
          Un paiement mobile money est remboursé sur le même numéro sous 72 heures, déduction faite des frais éventuellement retenus. Un paiement en espèces est remboursé par mobile money au
          numéro que vous nous indiquez, ou déduit de votre prochaine commande si vous le préférez. Demandes : WhatsApp ou {COMPANY.email}.
        </p>
      </section>
    </>
  );
}
