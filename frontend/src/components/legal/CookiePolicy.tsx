import Link from "next/link";
import { COOKIE_NOTICE_KEY } from "@/lib/legal";

// i18n-ignore-file : texte juridique en français (langue officielle du Togo).
// Politique relative aux cookies et au stockage local. À tenir à jour avec les clés utilisées dans src/lib.
const ITEMS: [string, string, string][] = [
  ["lang (cookie)", "Langue choisie (français ou anglais)", "1 an"],
  ["zedeka.customer, zedeka.driver, jetons de l'espace restaurant et de l'admin", "Session de connexion", "Jusqu'à la déconnexion"],
  ["zedeka.cart", "Panier en cours (un restaurant à la fois)", "Jusqu'à la commande ou au vidage"],
  ["zedeka.place, zedeka.position, zedeka.contact, zedeka.recipients", "Point de livraison, coordonnées et destinataires pré-remplis", "Jusqu'à la déconnexion ou l'effacement"],
  ["zedeka.recent, zedeka.ordered, zedeka.guest", "Commandes passées depuis cet appareil, pour les suivre sans compte", "Sur l'appareil, jusqu'à l'effacement"],
  ["zedeka.driver.queue, zedeka.driver.application", "Application livreur : actions en attente de réseau, candidature envoyée", "Jusqu'à l'envoi"],
  ["zedeka.installDismissed, zedeka.nativePushOff, " + COOKIE_NOTICE_KEY, "Choix d'affichage (installation, notifications, ce bandeau)", "Sur l'appareil"],
];

export default function CookiePolicy() {
  return (
    <>
      <section>
        <h2>En bref</h2>
        <p>
          Zedeka n&apos;utilise que des cookies et un stockage local strictement nécessaires au fonctionnement du service. Aucun cookie publicitaire, aucun traceur de réseau social, aucun outil de
          mesure d&apos;audience. Ces éléments étant indispensables, ils ne demandent pas votre accord ; le bandeau affiché à la première visite sert à vous en informer.
        </p>
      </section>
      <section>
        <h2>Ce qui est enregistré sur votre appareil</h2>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Tableau des cookies, défilable">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <caption className="sr-only">Cookies et stockage local utilisés par Zedeka</caption>
            <thead>
              <tr className="border-b border-stone-200">
                <th scope="col" className="py-2 pr-3 font-semibold">Nom</th>
                <th scope="col" className="py-2 pr-3 font-semibold">À quoi il sert</th>
                <th scope="col" className="py-2 font-semibold">Durée</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS.map(([name, purpose, duration]) => (
                <tr key={name} className="border-b border-stone-100 align-top">
                  <td className="py-2 pr-3 font-mono text-xs break-words">{name}</td>
                  <td className="py-2 pr-3">{purpose}</td>
                  <td className="py-2">{duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h2>Services tiers</h2>
        <p>
          Les fonds de carte viennent d&apos;OpenStreetMap, qui reçoit votre adresse IP mais ne dépose pas de cookie de suivi. La police d&apos;écriture est servie par le site lui-même. Voir la liste
          complète des prestataires dans la <Link href="/confidentialite">politique de confidentialité</Link>.
        </p>
      </section>
      <section>
        <h2>Effacer ces données</h2>
        <p>
          Se déconnecter efface la session. Vous pouvez tout effacer dans les réglages de votre navigateur (données du site) ou en désinstallant l&apos;application. Le service fonctionnera de
          nouveau normalement, mais votre panier et vos préférences seront perdus.
        </p>
      </section>
    </>
  );
}
