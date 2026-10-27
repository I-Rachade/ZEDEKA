import type { Metadata } from "next";
import Link from "next/link";
import InfoPage from "../InfoPage";
import { getPolicies } from "../policies";

export const metadata: Metadata = { title: "Aide – Zedeka" };

const FAQ: [string, React.ReactNode][] = [
  ["Comment suivre ma commande ?", <>Ouvrez l&apos;onglet Commandes : chaque commande a sa page de suivi, mise à jour à chaque étape.</>],
  ["Comment payer ?", <>En espèces à la livraison, ou par mobile money (T-Money ou Flooz). Le montant exact est confirmé sur WhatsApp.</>],
  ["Le livreur ne trouve pas mon adresse", <>Indiquez toujours un repère précis (portail, boutique, église) et, si possible, votre position. Le livreur vous appelle au numéro de la commande.</>],
  ["Puis-je commander sans compte ?", <>Oui. Le compte sert à retrouver vos commandes et vos adresses sur n&apos;importe quel téléphone.</>],
  ["Je n'ai pas reçu le code", <>Vérifiez le numéro saisi et patientez une minute avant d&apos;en redemander un. Un code est valable 10 minutes.</>],
];

export default async function Help() {
  const policies = await getPolicies();
  return (
    <InfoPage title="Aide et contact">
      {policies?.whatsapp && (
        <a href={`https://wa.me/${policies.whatsapp}`} target="_blank" rel="noopener noreferrer" className="block rounded-2xl bg-emerald-600 p-4 text-center font-semibold text-white">
          Écrire à Zedeka sur WhatsApp
        </a>
      )}
      {FAQ.map(([q, a]) => (
        <section key={q}>
          <h2>{q}</h2>
          <p>{a}</p>
        </section>
      ))}
      <p>
        Voir aussi les{" "}
        <Link href="/app/annulation" className="text-emerald-700 underline">
          règles d&apos;annulation
        </Link>
        .
      </p>
    </InfoPage>
  );
}
