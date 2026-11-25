import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { CopierNumero, Tarifs } from "./Interactif";
import s from "./decouvrir.module.css";

// Page de présentation de Zedeka (services, téléchargement des applis, tarifs), validée par Rachade le 25 nov. 2026.
// Prix repris de la fiche marque (knowledge/claude/fiche-marque.md) : ne mettre ici que des prix validés, toujours avec « dès ».
// Page en français seulement : c'est un support marketing pour Lomé.

export const metadata: Metadata = {
  title: "Zedeka – Livraison de repas, colis et boutiques à Lomé",
  description: "Repas, colis et boutiques de Lomé livrés en moto électrique. Livraison repas dès 500 F. Téléchargez les applis Zedeka.",
  alternates: { canonical: "/decouvrir" },
};

const NUMERO = "+228 78 27 87 44";
const WA = "https://wa.me/22878278744";
const VERSION = "version du 12 nov. 2026";

const icones = {
  client: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></svg>
  ),
  livreur: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="18.5" cy="17.5" r="3.5" /><path d="M15 6h3l2 6M5.5 17.5 9 10h6l3.5 7.5M12 10 10 6H7" /></svg>
  ),
  restaurant: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 2v7a3 3 0 0 0 6 0V2M6 2v20M18 15V2a4 4 0 0 0-4 4v6a3 3 0 0 0 3 3h1zm0 0v7" /></svg>
  ),
  marchand: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9h18l-1.5-5h-15z" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /></svg>
  ),
};

const APPLIS = [
  { id: "client", web: "/app", nom: "Zedeka", pour: "Pour les clients", texte: "Commande un repas, envoie un colis, achète en boutique.", principal: true },
  { id: "livreur", web: "/livreur", nom: "Zedeka Livreur", pour: "Pour les livreurs", texte: "Reçois les courses près de toi, suis tes gains. Moto électrique au jour." },
  { id: "restaurant", web: "/restaurant", nom: "Zedeka Restaurant", pour: "Pour les restaurants", texte: "Recevez les commandes, gérez votre menu et vos horaires. 0 % de commission." },
  { id: "marchand", web: "/marchand", nom: "Zedeka Marchand", pour: "Pour les boutiques et vendeuses", texte: "Ouvrez votre boutique en ligne, envoyez vos colis en groupe, suivez votre argent." },
] as const;

function Grille({ entete, lignes }: { entete: [string, string, string]; lignes: [string, string, React.ReactNode][] }) {
  return (
    <div className={s.grille}>
      <table>
        <thead>
          <tr>{entete.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {lignes.map(([a, b, c]) => (
            <tr key={a}>
              <td>{a}</td>
              <td className={s.p}>{b}</td>
              <td>{c}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AConfirmer = ({ children = "à confirmer" }: { children?: string }) => <span className={s.afc}>{children}</span>;

export default function Decouvrir() {
  return (
    <div className={s.page}>
      <header className={s.top}>
        <div className={s.topIn}>
          <Link href="/decouvrir" aria-label="Zedeka">
            <Logo size="sm" />
          </Link>
          <nav className={s.links} aria-label="Sections">
            <a href="#services">Services</a>
            <a href="#applis">Applis</a>
            <a href="#tarifs">Tarifs</a>
            <a href="#contact">Contact</a>
          </nav>
          <a className={s.btnVert} href="#applis">Télécharger</a>
        </div>
      </header>

      <main id="contenu">
        <section className={s.hero}>
          <div className={s.heroIn}>
            <div>
              <p className={s.eyebrowSoleil}>Lomé · motos électriques</p>
              <h1>
                Tu commandes, le livreur est <span className={s.sun}>déjà en route.</span>
              </h1>
              <p className={s.lead}>Repas, colis et boutiques de Lomé livrés en moto électrique. Tu paies à la livraison, en espèces.</p>
              <div className={s.ctas}>
                <a className={s.btnSoleil} href="#applis">Télécharger l&apos;appli</a>
                <Link className={s.btnLigne} href="/app">Commander sur le site</Link>
              </div>
              <div className={s.chiffres}>
                <span>Repas dès 500 F</span>
                <span>1 500 F maximum</span>
                <span>0 % de commission</span>
              </div>
            </div>
            <div className={s.ticket} aria-label="Calcul du prix de livraison d'un repas">
              <div className={s.ticketHead}>
                <b>Livraison repas</b>
                <span>comment on calcule</span>
              </div>
              <div className={s.row}><span>Prix de départ</span><span>dès 500 F</span></div>
              <div className={s.row}><span>Par kilomètre</span><span>100 F</span></div>
              <div className={s.row}><span>Plafond</span><span>1 500 F</span></div>
              <div className={s.total}><span>Tu ne paies jamais plus de</span><span>1 500 F</span></div>
              <small>Le prix exact s&apos;affiche dans l&apos;appli avant de valider.</small>
            </div>
          </div>
        </section>

        <section className={s.band} id="services">
          <div className={s.wrap}>
            <div className={s.secHead}>
              <p className={s.eyebrow}>Nos services</p>
              <h2>Trois façons de te faire livrer</h2>
              <p className={s.muted}>Une seule appli, un seul numéro. Les livreurs roulent en moto électrique.</p>
            </div>
            <div className={s.services}>
              {[
                { img: "/services/repas.webp", alt: "Plat togolais livré", titre: "Repas", texte: "Choisis un restaurant de ton quartier, commande, suis ton livreur sur la carte.", prix: "Livraison dès 500 F" },
                { img: "/services/colis.webp", alt: "Livreur qui remet un colis", titre: "Colis", texte: "Envoie un paquet d'un point à l'autre de Lomé. Le destinataire suit la livraison.", prix: "Livraison dès 1 000 F" },
                { img: "/services/boutiques.webp", alt: "Cliente avec des sacs de boutique", titre: "Boutiques en ligne", texte: "Vêtements, téléphones, beauté : achète chez les boutiques de Lomé et fais-toi livrer.", prix: "Livraison colis dès 1 000 F" },
              ].map((v) => (
                <article key={v.titre} className={s.svc}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.img} alt={v.alt} width={360} height={225} loading="lazy" />
                  <div className={s.svcIn}>
                    <h3>{v.titre}</h3>
                    <p className={s.muted}>{v.texte}</p>
                    <p className={s.prix}>{v.prix}</p>
                  </div>
                </article>
              ))}
            </div>
            <p className={s.illu}>Images d&apos;illustration.</p>
          </div>
        </section>

        <section className={s.bandCreme} id="applis">
          <div className={s.wrap}>
            <div className={s.secHead}>
              <p className={s.eyebrow}>Télécharger</p>
              <h2>Une appli pour chacun</h2>
              <p className={s.muted}>Sur Android, télécharge l&apos;appli. Sur iPhone ou ordinateur, ouvre-la directement sur le web.</p>
            </div>
            <div className={s.apps}>
              {APPLIS.map((a) => (
                <article key={a.id} className={"principal" in a ? s.appPrincipal : s.app}>
                  <div className={s.ico}>{icones[a.id]}</div>
                  <h3>{a.nom}</h3>
                  <span className={s.pour}>{a.pour}</span>
                  <p>{a.texte}</p>
                  <a className={s.btnVert} href={`/telecharger/zedeka-${a.id}.apk`} download>
                    Télécharger (Android)
                  </a>
                  <Link className={s.btnWeb} href={a.web}>
                    Ouvrir sur le web
                  </Link>
                  <span className={`${s.meta} ${s.tnum}`}>APK · 6 Mo · {VERSION}</span>
                </article>
              ))}
            </div>
            <div className={s.install}>
              <div>
                <b>Installer sur Android</b>
                <ol>
                  <li>Appuie sur « Télécharger ».</li>
                  <li>Ouvre le fichier téléchargé.</li>
                  <li>Si le téléphone le demande, autorise l&apos;installation depuis ce navigateur.</li>
                </ol>
              </div>
              <div>
                <b>Bientôt sur Google Play et l&apos;App Store</b>
                <p className={s.muted} style={{ marginTop: 8 }}>
                  Les boutons des stores remplaceront ces fichiers dès que les applis seront publiées. <AConfirmer>date à confirmer</AConfirmer>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={s.band} id="tarifs">
          <div className={s.wrap}>
            <div className={s.secHead}>
              <p className={s.eyebrow}>Tarifs</p>
              <h2>Des prix clairs, affichés avant de payer</h2>
            </div>
            <Tarifs
              panneaux={[
                {
                  id: "clients",
                  label: "Clients",
                  contenu: (
                    <>
                      <Grille
                        entete={["Service", "Prix", "Détail"]}
                        lignes={[
                          ["Livraison repas", "dès 500 F", "100 F par km, 1 500 F maximum"],
                          ["Livraison colis", "dès 1 000 F", "150 F par km, 3 000 F maximum"],
                          ["Zedeka+ (abonnement fidélité)", "2 500 F / mois", "Livraison des repas offerte dès 3 000 F de commande"],
                        ]}
                      />
                      <p className={s.note}>Tu paies à la livraison, en espèces. Le prix exact s&apos;affiche avant de valider la commande.</p>
                    </>
                  ),
                },
                {
                  id: "restaurants",
                  label: "Restaurants",
                  contenu: (
                    <>
                      <div className={s.formules}>
                        {[
                          { nom: "Essentiel", prix: "15 000 F", cls: s.formule, avantages: ["Page restaurant et menu en ligne dans l'appli Zedeka", "Commandes reçues sur l'appli Zedeka Restaurant, horaires à votre main", "Livraison par les livreurs Zedeka", "Jusqu'à 300 commandes livrées par mois"] },
                          { nom: "Standard", prix: "25 000 F", cls: s.formuleMilieu, avantages: ["Tout Essentiel, sans limite de commandes", "Caisse sur place et QR code sur les tables", "Plusieurs comptes pour votre équipe", "Mise en avant sur l'accueil de l'appli"] },
                          { nom: "Pro", prix: "35 000 F", cls: s.formule, avantages: ["Tout Standard", "Un livreur salarié dédié au service du midi", "Écran de cuisine avec les commandes en direct", "Bilan du mois : ventes et plats les plus commandés"] },
                        ].map((f) => (
                          <div key={f.nom} className={f.cls}>
                            <span className={s.tag}>0 % de commission</span>
                            <h3>{f.nom}</h3>
                            <p className={s.montant}>{f.prix} <small>/ mois</small></p>
                            <ul className={s.avantages}>
                              {f.avantages.map((a) => (
                                <li key={a}>{a}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      <p className={s.note}>
                        Un abonnement fixe, aucun pourcentage sur vos ventes. Caution de 25 000 F.
                      </p>
                    </>
                  ),
                },
                {
                  id: "boutiques",
                  label: "Boutiques",
                  contenu: (
                    <>
                      <Grille
                        entete={["Offre", "Prix", "Détail"]}
                        lignes={[
                          ["Livraison d'un colis", "dès 1 000 F", "150 F par km, 3 000 F maximum"],
                          ["Forfait marchand", "800 F / colis", "Au-delà de 20 colis par mois"],
                        ]}
                      />
                      <p className={s.note}>Boutique en ligne dans l&apos;appli Zedeka Marchand. Délai de reversement de l&apos;argent <AConfirmer /></p>
                    </>
                  ),
                },
                {
                  id: "livreurs",
                  label: "Livreurs",
                  contenu: (
                    <>
                      <Grille
                        entete={["Moto électrique", "Prix", "Détail"]}
                        lignes={[
                          ["Moto rechargeable à la maison", "1 000 F / jour", "Tu la recharges chez toi"],
                          ["Moto Zedeka", "2 000 F / jour", "Location au jour"],
                        ]}
                      />
                      <p className={s.note}>
                        <Link href="/livreur/candidature" style={{ textDecoration: "underline" }}>Inscris-toi comme livreur</Link>
                      </p>
                    </>
                  ),
                },
              ]}
            />
          </div>
        </section>

        <section className={s.contact} id="contact">
          <div className={s.contactIn}>
            <div className={s.contactCol}>
              <p className={s.eyebrowSoleil}>Contact</p>
              <h2>Une question ? Écris-nous sur WhatsApp</h2>
              <p className={s.num}>{NUMERO}</p>
              <div className={s.row2}>
                <a className={s.btnSoleil} href={`${WA}?text=SITE`}>Écrire sur WhatsApp</a>
                <CopierNumero numero={NUMERO} />
              </div>
            </div>
            <div className={s.card}>
              <h3>Restaurant ou boutique ?</h3>
              <p>Vous voulez recevoir des commandes sans commission ? Écrivez « PARTENAIRE » sur WhatsApp, l&apos;équipe vous rappelle.</p>
              <a className={s.btnLigne} style={{ color: "#fff" }} href={`${WA}?text=PARTENAIRE`}>Devenir partenaire</a>
            </div>
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={s.footerIn}>
          <span>Zedeka · Lomé, Togo</span>
          <span>
            <Link href="/conditions">Conditions</Link> · <Link href="/confidentialite">Confidentialité</Link> · <Link href="/mentions-legales">Mentions légales</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
