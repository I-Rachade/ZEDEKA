import type { Metadata } from "next";
import { fcfa } from "@/lib/api";
import { getLang, getT } from "@/lib/i18n/server";
import InfoPage from "../InfoPage";
import { getPolicies } from "../policies";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Annulation")} – Zedeka` };
}

// Texte juridique : rédigé dans chaque langue plutôt que phrase par phrase (i18n-ignore-file).
export default async function Cancellation() {
  const p = await getPolicies();
  const minutes = p?.freeCancellationMinutes ?? 5;
  const percent = p?.cancellationFeePercent ?? 50;
  if ((await getLang()) === "en") {
    return (
      <InfoPage title="Annulation et remboursement">
        <section>
          <h2>Meals and parcels</h2>
          <ul>
            <li>
              Free cancellation for <strong>{minutes} minutes</strong> after ordering.
            </li>
            <li>
              After that, <strong>{percent}%</strong> of the delivery fee is kept (for example {fcfa(Math.round((1000 * percent) / 100))} on a {fcfa(1000)} delivery).
            </li>
            <li>Once the meal is being prepared or the parcel picked up, the order can no longer be cancelled.</li>
            <li>To cancel, message us on WhatsApp with the order code.</li>
          </ul>
        </section>
        <section>
          <h2>Refunds</h2>
          <p>A mobile money payment already made is refunded to the same number within 72 hours, minus any fees kept.</p>
        </section>
      </InfoPage>
    );
  }
  return (
    <InfoPage title="Annulation et remboursement">
      <section>
        <h2>Repas et colis</h2>
        <ul>
          <li>
            Annulation gratuite pendant les <strong>{minutes} minutes</strong> qui suivent la commande.
          </li>
          <li>
            Ensuite, <strong>{percent} %</strong> des frais de livraison sont retenus (par exemple {fcfa(Math.round((1000 * percent) / 100))} sur une livraison à {fcfa(1000)}).
          </li>
          <li>Une fois le repas en préparation ou le colis récupéré, la commande ne peut plus être annulée.</li>
          <li>Pour annuler, écrivez-nous sur WhatsApp avec le code de la commande.</li>
        </ul>
      </section>
      <section>
        <h2>Remboursement</h2>
        <p>Un paiement mobile money déjà effectué est remboursé sur le même numéro, déduction faite des frais éventuellement retenus, sous 72 heures.</p>
      </section>
    </InfoPage>
  );
}
