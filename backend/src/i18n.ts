import type { NextFunction, Request, Response } from "express";

// L'API écrit ses messages en français. Pour un visiteur qui a choisi l'anglais (cookie `lang` posé par le site,
// ou en-tête `x-lang` pour les appels faits par le serveur du site), les messages connus sont traduits
// juste avant l'envoi de la réponse. Un message absent du dictionnaire reste en français.

export type Lang = "fr" | "en";

export function langOf(req: Request): Lang {
  const header = req.get("x-lang");
  if (header === "en" || header === "fr") return header;
  const cookie = /(?:^|;\s*)lang=(en|fr)(?:;|$)/.exec(req.get("cookie") ?? "");
  return cookie?.[1] === "en" ? "en" : "fr";
}

const EN: Record<string, string> = {
  // Connexion, comptes, codes
  "Connexion requise": "Sign-in required",
  "Session expirée, reconnectez-vous": "Session expired, please sign in again",
  "Jeton invalide": "Invalid token",
  "Adresse ou mot de passe incorrect": "Wrong address or password",
  "Adresse e-mail invalide": "Invalid email address",
  "Compte désactivé ou supprimé": "Account deactivated or deleted",
  "Réservé au directeur": "Director only",
  "Le statut salarié et le salaire sont réservés au directeur": "Staff status and salary are for the director only",
  "Mot de passe : 10 caractères minimum": "Password: 10 characters minimum",
  "Vous ne pouvez pas retirer vos propres droits de directeur": "You can't remove your own director rights",
  "Accès réservé à l'équipe Zedeka": "Access restricted to the Zedeka team",
  "Connexion admin désactivée : secrets du serveur trop faibles (voir les journaux du Worker)": "Admin sign-in disabled: server secrets are too weak (see the Worker logs)",
  "Mot de passe incorrect": "Wrong password",
  "Mot de passe actuel incorrect": "Current password is wrong",
  "Mot de passe actuel requis": "Current password required",
  "E-mail ou mot de passe incorrect": "Wrong email or password",
  "Code incorrect": "Wrong code",
  "Code expiré. Demandez-en un nouveau.": "Code expired. Request a new one.",
  "Trop d'essais. Demandez un nouveau code.": "Too many attempts. Request a new code.",
  "Trop de codes demandés. Réessayez dans une heure.": "Too many codes requested. Try again in an hour.",
  "Trop de demandes. Réessayez dans une heure.": "Too many requests. Try again in an hour.",
  "Trop de tentatives. Réessayez dans une minute.": "Too many attempts. Try again in a minute.",
  "Ce numéro ne peut pas recevoir de SMS.": "This number can't receive text messages.",
  "L'envoi du code a échoué. Réessayez dans un instant.": "Sending the code failed. Try again in a moment.",
  "Vérification impossible pour le moment. Réessayez dans un instant.": "Verification isn't possible right now. Try again in a moment.",
  "L'envoi des codes n'est pas encore disponible. Commandez sans compte en attendant.": "Sign-in codes aren't available yet. Order without an account for now.",
  "L'envoi des codes n'est pas encore disponible. Appelez la répartition.": "Sign-in codes aren't available yet. Call dispatch.",
  "Le code a 6 chiffres": "The code has 6 digits",
  "Aucun livreur n'est inscrit avec ce numéro.": "No driver is registered with this number.",
  "Compte livreur suspendu. Appelez la répartition.": "Driver account suspended. Call dispatch.",
  "Ce numéro est déjà enregistré": "This number is already registered",
  "Au moins un chiffre": "At least one digit",
  "Au moins une lettre": "At least one letter",
  "Un chiffre requis": "A digit is required",
  "Une majuscule requise": "An uppercase letter is required",
  "Une minuscule requise": "A lowercase letter is required",
  "8 caractères minimum": "8 characters minimum",
  "au moins 8 caractères": "at least 8 characters",

  // Validation
  "Données invalides": "Invalid data",
  "Certains champs sont à corriger.": "Some fields need fixing.",
  "champ obligatoire": "required field",
  "type invalide": "invalid type",
  "valeur non autorisée": "value not allowed",
  "Cette valeur existe déjà": "This value already exists",
  "Numéro de téléphone invalide": "Invalid phone number",
  "Numéro togolais invalide": "Invalid Togolese number",
  "Numéro togolais invalide (8 chiffres)": "Invalid Togolese number (8 digits)",
  "Numéro Mobile Money invalide": "Invalid mobile money number",
  "e-mail invalide": "invalid email",
  "lien invalide": "invalid link",
  "Le lien doit commencer par https://": "The link must start with https://",
  "heure au format HH:MM": "time in HH:MM format",
  "minuscules, chiffres et tirets": "lowercase letters, digits and hyphens",
  "Nom obligatoire": "Name required",
  "Prénom obligatoire": "First name required",
  "Indiquez votre nom": "Enter your name",
  "Indiquez le nom du commerce": "Enter the business name",
  "Indiquez le quartier": "Enter the neighbourhood",
  "Indiquez une adresse ou un repère": "Enter an address or a landmark",
  "Donnez un nom à l'adresse": "Give the address a name",
  "Décrivez un repère (portail, boutique, église…)": "Describe a landmark (gate, shop, church…)",
  "Choisissez la zone": "Choose the zone",
  "Choisissez une zone": "Choose a zone",
  "Choisissez un opérateur": "Choose an operator",
  "Choisissez un type de commerce": "Choose a business type",
  "Choisissez une formule": "Choose a plan",
  "Vous devez accepter les conditions": "You must accept the terms",
  "Votre accord est nécessaire": "Your consent is required",
  "Entre 5 et 180 min": "Between 5 and 180 min",
  "Doit être ≥ au minimum": "Must be ≥ the minimum",
  "Fichier obligatoire": "File required",
  "Format non accepté": "Format not accepted",
  "Fichier trop lourd (max 2 Mo)": "File too large (max 2 MB)",
  "Fichier refusé": "File rejected",
  "Une candidature existe déjà avec cet e-mail.": "An application already exists with this email.",
  "Zone inconnue": "Unknown zone",
  "Zone inconnue.": "Unknown zone.",

  // Introuvables
  Introuvable: "Not found",
  "Commande introuvable": "Order not found",
  "Restaurant introuvable": "Restaurant not found",
  "Plat introuvable": "Dish not found",
  "Course introuvable": "Delivery not found",
  "Zone introuvable": "Zone not found",
  "Candidature introuvable": "Application not found",
  "Signalement introuvable": "Report not found",
  "Fichier introuvable": "File not found",
  "Adresse introuvable": "Address not found",
  "Article introuvable dans la commande": "Item not found in the order",
  "Demande introuvable ou expirée": "Request not found or expired",
  "Aucune commande ne correspond à ce code et ce numéro": "No order matches this code and number",
  "Aucun colis ne correspond à ce code et ce numéro": "No parcel matches this code and number",
  "Aucune livraison précédente à ce numéro": "No previous delivery to this number",
  "Erreur interne": "Internal error",

  // Commandes et colis
  "Zone de livraison inconnue": "Unknown delivery zone",
  "Catégorie de colis inconnue": "Unknown parcel category",
  "Adresse de livraison trop courte": "Delivery address too short",
  "Placez le point de livraison": "Place the delivery point",
  "Le panier est vide": "The cart is empty",
  "Panier trop grand": "Cart too large",
  "Indiquez l'adresse ou la position du destinataire": "Enter the recipient's address or location",
  "Indiquez l'adresse ou la position du retrait": "Enter the pickup address or location",
  "Indiquez le code de la commande et le numéro utilisé": "Enter the order code and the number used",
  "Indiquez votre nom avant de demander la position": "Enter your name before requesting the location",
  "Le paiement mobile money n'est pas encore disponible : choisissez les espèces.": "Mobile money isn't available yet: choose cash.",
  "Le lien de position a expiré : demandez-en un nouveau, ou indiquez l'adresse.": "The location link has expired: request a new one, or enter the address.",
  "Ce lien n'est plus valable. Contactez la personne qui vous envoie le colis.": "This link is no longer valid. Contact the person sending you the parcel.",
  "Le colis est déjà confié à un livreur : la position ne peut plus être demandée.": "The parcel is already with a driver: the location can no longer be requested.",
  "Le colis est déjà confié à un livreur : contactez Zedeka pour changer le point de livraison.": "The parcel is already with a driver: contact Zedeka to change the delivery point.",
  "Position introuvable dans ce lien. Dans Google Maps, touchez le point puis « Partager » et copiez le lien.":
    "No location found in this link. In Google Maps, tap the point, then “Share”, and copy the link.",
  "En attente de la position du destinataire : le prix n'est pas encore fixé": "Waiting for the recipient's location: the price isn't set yet",
  "Cette commande est déjà clôturée": "This order is already closed",
  "Commande annulée": "Order cancelled",
  "Montants non modifiables sur une commande clôturée": "Amounts can't be changed on a closed order",
  "La remise dépasse le montant de la commande": "The discount exceeds the order amount",
  "Attribuez d'abord la zone de livraison": "Assign the delivery zone first",
  "Indiquez le motif d'annulation": "Enter the cancellation reason",
  "Livreur indisponible": "Driver unavailable",
  "Position du destinataire non reçue dans les 24 heures": "Recipient's location not received within 24 hours",

  // Restaurants
  "Le restaurant est momentanément fermé.": "The restaurant is temporarily closed.",
  "Le restaurant est fermé à cette heure-ci.": "The restaurant is closed at this time.",
  "Ce restaurant ne prend pas de commandes pour le moment.": "This restaurant isn't taking orders right now.",
  "Action impossible à ce stade de la commande": "Not possible at this stage of the order",
  "La commande ne peut plus être modifiée": "The order can no longer be changed",
  "La commande ne peut pas être vide : annulez-la plutôt": "The order can't be empty: cancel it instead",
  "Article modifié deux fois": "Item changed twice",
  "Aucune modification": "No changes",
  "Indiquez la raison (ex. plus de poulet)": "Enter the reason (e.g. out of chicken)",
  "Indiquez la raison du refus": "Enter the reason for rejecting",
  "Le délai minimum dépasse le maximum": "The minimum time exceeds the maximum",
  "Le minimum dépasse le maximum": "The minimum exceeds the maximum",
  "Indiquez le prix par km": "Enter the price per km",
  "Cette candidature a déjà été traitée": "This application has already been processed",
  "Un restaurant utilise déjà cet e-mail": "A restaurant already uses this email",
  "Période invalide": "Invalid period",
  "Aucune somme à encaisser pour ce livreur": "Nothing to collect from this driver",
  "Aucune commande à régler sur cette période": "No orders to settle for this period",
  "Service de notification inconnu": "Unknown notification service",

  // Formule partenaire (page « Devenir partenaire »)
  Abonnement: "Subscription",
  "Un prix fixe chaque mois, aucune commission sur vos ventes.": "A fixed price each month, no commission on your sales.",
  "Page commerce et QR code": "Business page and QR code",
  "Commandes reçues sur votre espace partenaire": "Orders received in your partner area",
  "Livraison par les livreurs Zedeka": "Delivery by Zedeka drivers",
  "Aucune commission sur les commandes": "No commission on orders",

  // Livreurs
  "Délai dépassé : la course a été retirée": "Time's up: the delivery was withdrawn",
  "Cette course ne vous est plus proposée": "This delivery is no longer offered to you",
  "La répartition a confié cette course à un autre livreur": "Dispatch gave this delivery to another driver",
  "Le restaurant n'a pas encore accepté la commande": "The restaurant hasn't accepted the order yet",
  "Étape impossible pour cette commande": "Step not possible for this order",
  "Indiquez le montant reçu en espèces": "Enter the cash amount received",
  "Le montant reçu diffère du total : indiquez pourquoi": "The amount received differs from the total: say why",
  "Pas de réponse": "No answer",
};

// Messages construits avec une valeur (montant, nom, nombre).
const PATTERNS: [RegExp, (...m: string[]) => string][] = [
  [/^Commande minimum : (.+) \(hors livraison\)$/, (a) => `Minimum order: ${a} (excluding delivery)`],
  [/^(\d+) adresses au maximum$/, (n) => `${n} addresses maximum`],
  [/^Code incorrect\. Encore (\d+) essais?\.$/, (n) => `Wrong code. ${n} attempt${n === "1" ? "" : "s"} left.`],
  [/^Article indisponible : (.+)$/, (x) => `Item unavailable: ${x}`],
  [/^Choisissez une variante pour « (.+) »$/, (x) => `Choose an option for “${x}”`],
  [/^Supplément indisponible pour « (.+) »$/, (x) => `Add-on unavailable for “${x}”`],
  [/^Quantité invalide pour (.+)$/, (x) => `Invalid quantity for ${x}`],
  [/^Retirez au moins une unité de (.+) pour la remplacer$/, (x) => `Remove at least one ${x} to replace it`],
  [/^Remplacement indisponible pour (.+)$/, (x) => `Replacement unavailable for ${x}`],
  [/^Le remplacement de (.+) doit coûter au plus le même prix$/, (x) => `The replacement for ${x} must cost no more than the same price`],
  [/^au moins (\d+) caractère\(s\)$/, (n) => `at least ${n} character(s)`],
  [/^au plus (\d+) caractères$/, (n) => `at most ${n} characters`],
  [/^minimum (\S+)$/, (n) => `minimum ${n}`],
  [/^maximum (\S+)$/, (n) => `maximum ${n}`],
  [/^Champ manquant : (.+)$/, (f) => `Missing field: ${f}`],
];

export function translateMessage(text: string, lang: Lang): string {
  if (lang === "fr") return text;
  const exact = EN[text];
  if (exact) return exact;
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(text);
    if (m) return fn(...m.slice(1));
  }
  // Message zod préfixé par le champ : « items.0.quantity : au moins 1 caractère(s) ».
  const field = /^([\w.]+) : (.+)$/.exec(text);
  if (field) {
    const inner = translateMessage(field[2], lang);
    if (inner !== field[2]) return `${field[1]}: ${inner}`;
  }
  return text;
}

function translateDeep(value: unknown, lang: Lang): unknown {
  if (typeof value === "string") return translateMessage(value, lang);
  if (Array.isArray(value)) return value.map((v) => translateDeep(v, lang));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translateDeep(v, lang)]));
  }
  return value;
}

// Traduit les réponses JSON pour les visiteurs en anglais (messages d'erreur, raisons de fermeture, formule…).
export function i18nResponses(req: Request, res: Response, next: NextFunction) {
  const lang = langOf(req);
  res.locals.lang = lang;
  if (lang !== "fr") {
    const json = res.json.bind(res);
    res.json = (body?: unknown) => json(translateDeep(body, lang));
  }
  next();
}

// SMS envoyés à la demande de la personne, dans sa langue.
export const sms = {
  passwordCode: (code: string, lang: Lang) =>
    lang === "en" ? `Zedeka: your code to change your password is ${code}. Valid for 15 minutes.` : `Zedeka : votre code pour changer de mot de passe est ${code}. Valable 15 minutes.`,
};
