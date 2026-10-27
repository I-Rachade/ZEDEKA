import type { Metadata } from "next";
import { fcfa } from "@/lib/api";
import InfoPage from "../InfoPage";
import { getPolicies } from "../policies";

export const metadata: Metadata = { title: "Annulation – Zedeka" };

export default async function Cancellation() {
  const p = await getPolicies();
  const minutes = p?.freeCancellationMinutes ?? 5;
  const percent = p?.cancellationFeePercent ?? 50;
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
        <h2>Location de véhicules</h2>
        <ul>
          <li>Une réservation peut être annulée sans frais tant que le loueur ne l&apos;a pas confirmée.</li>
          <li>Après confirmation, contactez le loueur ou Zedeka : les conditions du loueur s&apos;appliquent.</li>
        </ul>
      </section>
      <section>
        <h2>Remboursement</h2>
        <p>Un paiement mobile money déjà effectué est remboursé sur le même numéro, déduction faite des frais éventuellement retenus, sous 72 heures.</p>
      </section>
    </InfoPage>
  );
}
