import type { Metadata } from "next";
import Link from "next/link";
import { getLang, getT } from "@/lib/i18n/server";
import InfoPage from "../InfoPage";
import { getPolicies } from "../policies";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: `${t("Aide")} – Zedeka` };
}

// Questions rédigées dans chaque langue (i18n-ignore-file).
const FAQ: [string, React.ReactNode][] = [
  ["Comment suivre ma commande ?", <>Ouvrez l&apos;onglet Commandes : chaque commande a sa page de suivi, mise à jour à chaque étape.</>],
  ["Comment payer ?", <>En espèces à la livraison, ou par mobile money (T-Money ou Flooz). Le montant exact est confirmé sur WhatsApp.</>],
  ["Le livreur ne trouve pas mon adresse", <>Indiquez toujours un repère précis (portail, boutique, église) et, si possible, votre position. Le livreur vous appelle au numéro de la commande.</>],
  ["Puis-je commander sans compte ?", <>Oui. Le compte sert à retrouver vos commandes et vos adresses sur n&apos;importe quel téléphone.</>],
  ["Je n'ai pas reçu le code", <>Vérifiez le numéro saisi et patientez une minute avant d&apos;en redemander un. Un code est valable 10 minutes.</>],
];

const FAQ_EN: [string, React.ReactNode][] = [
  ["How do I track my order?", <>Open the Orders tab: each order has its own tracking page, updated at every step.</>],
  ["How do I pay?", <>Cash on delivery, or mobile money (T-Money or Flooz). The exact amount is confirmed on WhatsApp.</>],
  ["The rider can't find my address", <>Always give a precise landmark (gate, shop, church) and, if possible, your location. The rider calls you on the order&apos;s number.</>],
  ["Can I order without an account?", <>Yes. An account lets you find your orders and addresses on any phone.</>],
  ["I didn't get the code", <>Check the number you entered and wait a minute before asking for a new one. A code is valid for 10 minutes.</>],
];

export default async function Help() {
  const policies = await getPolicies();
  const t = await getT();
  const en = (await getLang()) === "en";
  return (
    <InfoPage title="Aide et contact">
      {policies?.whatsapp && (
        <a href={`https://wa.me/${policies.whatsapp}`} target="_blank" rel="noopener noreferrer" className="block rounded-2xl bg-emerald-600 p-4 text-center font-semibold text-white">
          {t("Écrire à Zedeka sur WhatsApp")}
        </a>
      )}
      {(en ? FAQ_EN : FAQ).map(([q, a]) => (
        <section key={q}>
          <h2>{q}</h2>
          <p>{a}</p>
        </section>
      ))}
      <p>
        {t("Voir aussi les")}{" "}
        <Link href="/app/annulation" className="text-emerald-700 underline">
          {t("règles d'annulation")}
        </Link>
        .
      </p>
    </InfoPage>
  );
}
