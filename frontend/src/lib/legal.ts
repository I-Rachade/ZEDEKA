// Identité de l'exploitant, reprise dans les mentions légales, les conditions et les politiques.
// Seul le nom Zedeka est publié ; le contact passe par WhatsApp (bouton Aide).
// i18n-ignore-file : identité légale, en français.
export const COMPANY = {
  brand: "Zedeka",
  city: "Lomé, Togo",
  host: "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis (cloudflare.com)",
};

// Date de la version en vigueur des textes ; à changer à chaque modification.
export const LEGAL_UPDATED = "1er novembre 2026";

// Âge minimum des livreurs (permis, contrat) ; aucun âge n'est demandé aux clients.
export const MIN_AGE = 18;

// Pages légales publiques, dans l'ordre du pied de page.
export const LEGAL_LINKS = [
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/conditions", label: "Conditions générales" },
  { href: "/confidentialite", label: "Confidentialité" },
  { href: "/remboursement", label: "Remboursement" },
  { href: "/cookies", label: "Cookies" },
  { href: "/suppression-donnees", label: "Supprimer mes données" },
  { href: "/conditions-partenaires", label: "Conditions partenaires" },
  { href: "/conditions-livreurs", label: "Conditions livreurs" },
];

// Seul élément enregistré par le bandeau : le choix, pour ne pas le remontrer.
export const COOKIE_NOTICE_KEY = "zedeka.cookieNotice";
