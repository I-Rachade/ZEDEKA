// Identité légale de l'exploitant, reprise dans les mentions légales, les conditions et les politiques.
// Les valeurs entre crochets sont à remplacer par celles du RCCM, du NIF (OTR) et du récépissé de l'IPDCP.
// i18n-ignore-file : identité légale, en français.
export const COMPANY = {
  brand: "Zedeka",
  legalName: "[Dénomination sociale]",
  form: "[Forme juridique : SARL, SARLU ou SAS]",
  capital: "[Capital social] FCFA",
  rccm: "[N° RCCM, ex. TG-LOM-01-2026-B13-00000]",
  nif: "[N° d'identification fiscale (NIF)]",
  address: "[Adresse du siège social], Lomé, Togo",
  manager: "[Nom du gérant ou du président]",
  email: "[contact@votre-domaine.tg]",
  phone: "[Téléphone du service client]",
  host: "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, États-Unis (cloudflare.com)",
  ipdcpReceipt: "[N° du récépissé de déclaration à l'IPDCP]",
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
