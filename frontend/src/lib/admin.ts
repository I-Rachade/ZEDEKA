"use client";

import { clearCache } from "./panelCache";
import { currentLang, dateLocale, tr } from "@/lib/i18n";
import { API_URL } from "./api";
import { useStored, writeStored } from "./device";

const TOKEN_KEY = "zedeka-admin-token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  if (!token) clearCache("admin");
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (!token) writeStored(STAFF_KEY, null);
  } catch {
    // stockage indisponible (navigation privée) : la session durera le temps de la page
  }
}

// Membre de l'équipe connecté. Le directeur voit tout ; la managerin, les commandes, la répartition, les livreurs,
// les restaurants (lecture) et les demandes ; le dispatcheur, les commandes, la répartition et les livreurs.
// L'administrateur adjoint voit tout et gère le travail courant, sans comptes, réglages, zones ni finances.
// Ressources humaines : l'outil RH seulement. Comptable : comptabilité, finances, rapport et leasing.
export type TeamRole = "DIRECTOR" | "DEPUTY" | "MANAGER" | "DISPATCHER" | "HR" | "ACCOUNTANT";
export type Staff = { id: string | null; name: string; role: TeamRole };
export const ROLE_LABEL: Record<TeamRole, string> = {
  DIRECTOR: "Directeur",
  DEPUTY: "Administrateur adjoint",
  MANAGER: "Managerin",
  DISPATCHER: "Dispatcheur",
  HR: "Ressources humaines",
  ACCOUNTANT: "Comptable",
};
// Sans membre enregistré (ancienne session au mot de passe ADMIN_PASSWORD) : directeur.
export const roleOf = (staff: Staff | null | undefined): TeamRole => staff?.role ?? "DIRECTOR";
// Tout l'admin à l'écran (directeur et administrateur adjoint) ; seul le directeur modifie équipe, réglages,
// zones, tarifs et finances.
export const seesEverything = (role: TeamRole) => role === "DIRECTOR" || role === "DEPUTY";
// Rôles de bureau sans accès aux opérations (commandes, répartition, livreurs) : leur page d'accueil, et les écrans
// qu'ils peuvent ouvrir (le reste les renvoie à leur accueil).
export const BACK_OFFICE_HOME: Partial<Record<TeamRole, string>> = { HR: "/admin/rh", ACCOUNTANT: "/admin/comptabilite" };
const BACK_OFFICE_PAGES: Partial<Record<TeamRole, RegExp>> = {
  HR: /^\/admin\/(rh)(\/|$)/,
  ACCOUNTANT: /^\/admin\/(comptabilite|finances|rapport|indicateurs|leasing)(\/|$)/,
};
export const backOfficeMayOpen = (role: TeamRole, pathname: string) => BACK_OFFICE_PAGES[role]?.test(pathname) ?? true;
// Modifie les RH ou la comptabilité (l'administrateur adjoint les consulte seulement).
export const editsHr = (role: TeamRole) => role === "DIRECTOR" || role === "HR";
export const editsAccounting = (role: TeamRole) => role === "DIRECTOR" || role === "ACCOUNTANT";

// Numéro pour un lien d'appel ou WhatsApp : chiffres seuls, indicatif du Togo (228) ajouté aux numéros à 8 chiffres.
export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "").replace(/^00/, "");
  return d.length === 8 ? `228${d}` : d;
}
export const telLink = (phone: string) => `tel:+${phoneDigits(phone)}`;
export const whatsappLink = (phone: string, text?: string) => `https://wa.me/${phoneDigits(phone)}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

// Demandes (appels, WhatsApp) des clients, restaurants, boutiques et livreurs, traitées par les managerins.
export type RequestSource = "CUSTOMER" | "RESTAURANT" | "DRIVER" | "OTHER";
export type RequestChannel = "WHATSAPP_CALL" | "WHATSAPP_MESSAGE" | "PHONE_CALL" | "OTHER";
export type RequestStatus = "OPEN" | "IN_PROGRESS" | "DONE";
export const REQUEST_SOURCE_LABEL: Record<RequestSource, string> = { CUSTOMER: "Client", RESTAURANT: "Restaurant ou boutique", DRIVER: "Livreur", OTHER: "Autre" };
export const REQUEST_CHANNEL_LABEL: Record<RequestChannel, string> = {
  WHATSAPP_CALL: "Appel WhatsApp",
  WHATSAPP_MESSAGE: "Message WhatsApp",
  PHONE_CALL: "Appel téléphonique",
  OTHER: "Autre",
};
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { OPEN: "À traiter", IN_PROGRESS: "En cours", DONE: "Close" };
export type SupportRequest = {
  id: string;
  source: RequestSource;
  channel: RequestChannel;
  direction: "IN" | "OUT";
  subject: string;
  details: string | null;
  contactName: string | null;
  contactPhone: string | null;
  status: RequestStatus;
  priority: "NORMAL" | "URGENT";
  orderId: string | null;
  restaurantId: string | null;
  order: { id: string; code: string; status: string; customerName: string; customerPhone: string } | null;
  restaurant: { id: string; name: string; phone: string } | null;
  createdBy: string;
  assignedTo: string | null;
  notes: { id: string; author: string; body: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};
const STAFF_KEY = "zedeka.admin.staff";
export const useStaff = () => useStored<Staff>(STAFF_KEY);
export const saveStaff = (s: Staff) => writeStored(STAFF_KEY, s);

export type TeamMember = { id: string; name: string; email: string; role: TeamRole; active: boolean; lastLoginAt: string | null; createdAt: string };

export class AuthError extends Error {}

// Session expirée pendant que la page est ouverte : Cloudflare Access (connexion à la double authentification,
// 6 h) ou le jeton de l'admin (12 h). Access ne répond pas en JSON : il renvoie vers sa page de connexion, ce
// qu'un fetch ne peut pas suivre (autre domaine). Sans ce repérage, la page restait affichée et chaque requête
// échouait en silence, comme une coupure réseau. Ici, l'admin le voit et la page se ferme (AdminShell).
const EXPIRED_EVENT = "zedeka-admin-session-expired";
let expired = false;
export const sessionHasExpired = () => expired;
export function onSessionExpired(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EXPIRED_EVENT, cb);
  return () => window.removeEventListener(EXPIRED_EVENT, cb);
}
function expireSession() {
  setToken(null);
  if (expired || typeof window === "undefined") return;
  expired = true;
  window.dispatchEvent(new Event(EXPIRED_EVENT));
}
// Après une nouvelle connexion (page /admin/connexion), la session repart de zéro.
export const resetSessionExpired = () => {
  expired = false;
};

// Requête vers l'API admin. Les renvois ne sont pas suivis : un renvoi ne vient que de Cloudflare Access.
// readBody : false pour un fichier (le corps n'est lu ici qu'en cas d'erreur).
async function adminRequest(path: string, init: RequestInit, readBody = true): Promise<{ res: Response; body: Record<string, unknown> | null }> {
  const hadToken = !!getToken();
  const res = await fetch(`${API_URL}/api/admin${path}`, { ...init, redirect: "manual" });
  // Access renvoie vers sa connexion : réponse « opaqueredirect » (statut 0), sans contenu lisible.
  if (res.type === "opaqueredirect" || res.status === 0) {
    expireSession();
    throw new AuthError(tr("Session expirée"));
  }
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  const body = isJson && (readBody || !res.ok) ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
  const error = typeof body?.error === "string" ? body.error : null;
  // 401 : jeton de l'admin expiré. 403 ACCESS_REQUIRED : jeton Access absent ou expiré (vérifié par l'API).
  if (res.status === 401 || (res.status === 403 && body?.code === "ACCESS_REQUIRED")) {
    if (hadToken) expireSession();
    else setToken(null);
    throw new AuthError(error ?? tr("Connexion requise"));
  }
  if (!res.ok) throw new Error(error ?? tr("Erreur {status}", { status: res.status }));
  return { res, body };
}

// Téléchargement authentifié (ex. export CSV).
export async function adminDownload(path: string, filename: string) {
  const { res } = await adminRequest(path, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } }, false);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { body } = await adminRequest(path, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken() ?? ""}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return (body ?? {}) as T;
}

// Photo d'un plat envoyée depuis l'appareil (déjà réduite par MenuEditor) ; renvoie son lien.
export async function adminUploadImage(path: string, photo: Blob): Promise<string> {
  const { body } = await adminRequest(path, {
    method: "POST",
    headers: { "Content-Type": photo.type, Authorization: `Bearer ${getToken() ?? ""}` },
    body: photo,
  });
  return body?.url as string;
}

// Avec une adresse : compte d'un membre de l'équipe. Sans : mot de passe du directeur des opérations.
export async function login(password: string, email?: string) {
  const res = await fetch(`${API_URL}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(email ? { email, password } : { password }),
    redirect: "manual",
  });
  // Connexion Cloudflare Access expirée elle aussi : la page rechargée passe d'abord par Access.
  if (res.type === "opaqueredirect") {
    window.location.reload();
    throw new Error(tr("Session expirée"));
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? tr("Connexion impossible"));
  setToken(body.token);
  resetSessionExpired();
  saveStaff({ id: null, name: body.name ?? "Direction", role: body.role ?? "DIRECTOR" });
}

// Mot de passe oublié d'un membre de l'équipe : code par e-mail, puis nouveau mot de passe.
async function postPublic(path: string, body: Record<string, string>) {
  const res = await fetch(`${API_URL}/api/admin${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? tr("Connexion impossible"));
  return data as { devCode?: string; expiresInMinutes?: number };
}
export const requestPasswordCode = (email: string) => postPublic("/password/forgot", { email });
export const resetPassword = (email: string, code: string, password: string) => postPublic("/password/reset", { email, code, password });

import type { OrderStatus } from "@/components/panel/status";
export { STATUS_LABEL } from "@/components/panel/status";
export type AdminOrderStatus = OrderStatus;

export type Vehicle = "MOTO" | "VELO" | "VOITURE";
export const VEHICLE_LABEL: Record<Vehicle, string> = { MOTO: "Moto", VELO: "Vélo", VOITURE: "Voiture" };

export type Employment = "FREELANCE" | "STAFF";
export const EMPLOYMENT_LABEL: Record<Employment, string> = { STAFF: "Salarié Zedeka", FREELANCE: "Indépendant" };

export type Driver = {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  status: "PENDING" | "APPROVED" | "REJECTED";
  online: boolean;
  vehicle: Vehicle;
  employment: Employment;
  monthlySalary: number | null;
  zoneId: string | null;
  zone?: { name: string } | null;
  ordersToday?: number;
  activeOrders?: number;
  // Note moyenne des clients (1 à 5) et nombre de notes.
  rating?: number | null;
  ratingCount?: number;
  lastSeenAt?: string | null;
  lastLatitude?: number | null;
  lastLongitude?: number | null;
  lastLocationAt?: string | null;
  // Code PIN de connexion à l'application livreur déjà choisi (jamais renvoyé lui-même).
  hasPin?: boolean;
  email?: string | null;
  // Services à la demande que fait le livreur (« ERRAND,GAS ») : il en reçoit les demandes.
  serviceCodes?: string;
  // Plaque vue par le client (la sienne, ou celle de la moto du parc prise par un salarié), pièces fournies et moto du parc.
  plate?: string | null;
  zedDocuments?: { kind: "SELFIE" | "ID_CARD" | "LICENCE" | "MOTO"; createdAt: string; issuedAt?: string | null; expiresAt?: string | null }[];
  motorbike?: { id: string; plate: string; label: string | null } | null;
};

// Parc de motos de Zedeka (livreurs salariés).
export type Motorbike = {
  id: string;
  plate: string;
  label: string | null;
  note: string | null;
  active: boolean;
  hasPhoto: boolean;
  assignedAt: string | null;
  createdAt: string;
  shifts30d: number;
  driver: { id: string; name: string; phone: string; online: boolean } | null;
};
export type FleetDriver = { id: string; name: string; online: boolean; active: boolean; vehicle: Vehicle; motorbike: { id: string; plate: string } | null };
export type MotorbikeShift = { id: string; startedAt: string; endedAt: string | null; assignedBy: string | null; driver: { name: string } };

// Image protégée de l'admin (pièce d'un livreur, photo d'une moto), rendue en adresse locale.
export async function adminImage(path: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/admin${path}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
    return res.ok ? URL.createObjectURL(await res.blob()) : null;
  } catch {
    return null;
  }
}

// Zone technique d'un colis sans position : la répartition lui attribue sa zone.
export const ZONE_TO_ASSIGN = "parcels";

export type AdminZone = {
  id: string;
  name: string;
  // La zone sert à placer les livreurs et à répartir les courses. deliveryFee : son prix fixe, appliqué quand les
  // Réglages facturent la livraison par zone (repas ou colis) ; au km, il est ignoré.
  deliveryFee: number;
  // Centre de la zone : un colis prend la zone dont le centre est le plus proche de son point de livraison.
  latitude: number | null;
  longitude: number | null;
  active: boolean;
};

export type AdminOption = { id: string; name: string; price: number; available?: boolean };

export type AdminMenuItem = {
  id: string;
  category: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  imageUrls?: string[];
  options?: { name: string; values: string[] }[];
  stock?: number | null;
  available: boolean;
  sortOrder: number;
  variants: AdminOption[];
  addons: { id: string }[];
};

// Lien envoyé au gérant pour qu'il indique la position de son restaurant.
export type RestaurantLocationLink = { url: string; text: string; whatsappUrl: string; expiresAt: string };

export type AdminRestaurant = {
  id: string;
  hasPin?: boolean; // le gérant peut se connecter par numéro et PIN
  payoutPhone?: string | null; // mobile money pour les reversements des relevés
  slug: string;
  name: string;
  phone: string;
  address: string;
  commissionRate: number;
  subscriptionFee: number | null; // abonnement mensuel (FCFA), null pour les anciens restaurants à la commission
  // Palier d'abonnement, commandes livrées ce mois et prix des paliers (fiche).
  plan?: "ESSENTIEL" | "PRO";
  deliveredThisMonth?: number;
  proAdvised?: boolean;
  planPrices?: { ESSENTIEL: number; PRO: number; limit: number };
  active: boolean;
  zoneId: string | null;
  zone?: { name: string } | null;
  deliveryTimeMin: number;
  deliveryTimeMax: number;
  logoUrl: string | null;
  ownerEmail?: string | null;
  latitude: number | null;
  longitude: number | null;
  // Position : placée, demandée au gérant (lien en attente), demande échue, ou manquante (anciens restaurants).
  locationState?: "SET" | "REQUESTED" | "EXPIRED" | "MISSING";
  locationRequestExpiresAt?: string | null;
  openingHours?: { day: number; open: string; close: string }[];
  // Renvoyé à la création quand la position est demandée au gérant.
  locationLink?: RestaurantLocationLink;
  _count?: { orders: number; menuItems: number };
  rating?: number | null;
  ratingCount?: number;
  menuItems?: AdminMenuItem[];
  addons?: AdminOption[];
  // Type de commerce : restaurant ou boutique (avec sa catégorie).
  kind?: CommerceKind;
  shopCategory?: string | null;
  reviewNewItems?: boolean;
  banners?: AdminBanner[];
  categories?: { key: string; label: string; emoji: string }[];
};

export type CommerceKind = "RESTAURANT" | "SHOP";

export type AdminBanner = { id: string; kind: "IMAGE" | "VIDEO"; url: string; posterUrl: string | null; title: string; menuItemId: string | null; position: number; active: boolean };

// Catégories d'une boutique (mêmes clés que l'API, store.ts).
export const SHOP_CATEGORIES = [
  { key: "mode", label: "Mode", emoji: "👗" },
  { key: "beaute", label: "Beauté", emoji: "💄" },
  { key: "telephones", label: "Téléphones et électronique", emoji: "📱" },
  { key: "epicerie", label: "Épicerie et boissons", emoji: "🛒" },
  { key: "supermarche", label: "Supermarché", emoji: "🧺" },
  { key: "pharmacie", label: "Pharmacie", emoji: "💊" },
  { key: "gaz-eau", label: "Gaz et eau", emoji: "🔥" },
  { key: "maison", label: "Maison et cuisine", emoji: "🏠" },
  { key: "enfants", label: "Enfants et bébé", emoji: "🧸" },
  { key: "sport", label: "Sport et loisirs", emoji: "⚽" },
  { key: "autres", label: "Autres", emoji: "🛍️" },
] as const;

// Canal d'une demande saisie au back-office (routes/adminManual.ts côté API).
export type ManualChannel = "PHONE" | "WHATSAPP" | "WALK_IN" | "OTHER";
export const CHANNEL_LABEL: Record<ManualChannel, string> = { PHONE: "Téléphone", WHATSAPP: "WhatsApp", WALK_IN: "Au bureau", OTHER: "Autre" };
// Origine d'une commande, pour la liste et le détail : null pour une commande passée dans l'appli.
export function orderOrigin(o: { source?: string; createdBy?: string | null }): string | null {
  if (o.source === "RESTAURANT") return "Saisie par le restaurant";
  const channel = CHANNEL_LABEL[o.source as ManualChannel];
  return channel ? channel : null;
}

export type AdminOrder = {
  id: string;
  // Messagerie écrite entre le client et le livreur (détail de la commande seulement).
  messages?: { id: string; from: "CUSTOMER" | "DRIVER"; body: string; at: string; readAt: string | null; driverName: string | null }[];
  code: string;
  restaurantId?: string | null;
  type: "FOOD" | "PARCEL";
  // Vente d'une boutique en ligne (colis du marchand au client) et ses articles.
  storeSale?: boolean;
  zoneId: string;
  // Colis : qui paie la livraison (le destinataire paie en espèces à la livraison).
  payer?: "SENDER" | "RECIPIENT";
  fulfillment: "DELIVERY" | "PICKUP";
  // Commande sur place, depuis le QR code d'une table : numéro de la table (null sinon).
  tableNumber?: number | null;
  // APP : passée dans l'appli ; RESTAURANT : livraison enregistrée par le restaurant (client venu par téléphone) ;
  // PHONE, WHATSAPP, WALK_IN, OTHER : saisie au back-office par l'équipe (createdBy : qui l'a saisie).
  source?: "APP" | "RESTAURANT" | ManualChannel;
  createdBy?: string | null;
  // Livreur favori : FAVORITE (proposée d'abord aux favoris), OPEN (demande ouverte), null (pas encore décidé).
  dispatchRoute?: "FAVORITE" | "OPEN" | null;
  status: AdminOrderStatus;
  customerName: string;
  customerPhone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  note: string | null;
  pickupAddress: string | null;
  pickupLatitude?: number | null;
  pickupLongitude?: number | null;
  locationSource?: "SENDER" | "RECIPIENT" | null;
  // Détail seulement : demande de position envoyée au destinataire d'un colis.
  locationRequest?: { status: "PENDING" | "OPENED" | "SHARED" | "DECLINED" | "EXPIRED" | "REVOKED"; expiresAt: string; accuracyM: number | null; respondedAt: string | null } | null;
  recipientName: string | null;
  recipientPhone: string | null;
  weightKg: number | null;
  parcelCategory: { name: string } | null;
  paymentMethod: "CASH" | "MOBILE_MONEY";
  paymentStatus: "UNPAID" | "PAID";
  subtotal: number;
  discount: number;
  deliveryFee: number;
  extraFee: number;
  total: number;
  commission: number;
  driverEarning: number;
  cancellationFee: number;
  cancellationReason: string | null;
  // Clôture par le client et notes.
  handedOverAt?: string | null;
  closedBy?: "CUSTOMER" | "CODE" | "AUTO" | "ADMIN" | "DRIVER" | null;
  receiptDisputedAt?: string | null;
  receiptDisputeNote?: string | null;
  driverRating?: number | null;
  restaurantRating?: number | null;
  ratingComment?: string | null;
  createdAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  prepMinutes: number | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  // Code promo appliqué et qui paie la remise ; personne du restaurant qui a accepté.
  promoCode?: string | null;
  promoPayer?: "ZEDEKA" | "RESTAURANT" | null;
  confirmedBy?: string | null;
  confirmedByRole?: "OWNER" | "MANAGER" | "CASHIER" | null;
  restaurant: { name: string; phone: string; address?: string } | null;
  zone: { name: string };
  driver: { id: string; name: string; phone: string } | null;
  items: { name: string; variantName: string | null; addons: { name: string; price: number }[]; quantity: number; unitPrice: number }[];
};

// « t » : traduction de la page qui affiche le titre.
export const orderTitle = (o: Pick<AdminOrder, "type" | "restaurant" | "parcelCategory">, t: (fr: string) => string = (fr) => fr) =>
  o.type === "PARCEL" ? `${t("Colis")}${o.parcelCategory ? ` · ${o.parcelCategory.name}` : ""}` : (o.restaurant?.name ?? t("Repas"));

// Étape suivante proposée à l'admin ; à emporter, une commande prête est remise au client.
export function nextStatus(o: Pick<AdminOrder, "status" | "type" | "fulfillment">): AdminOrderStatus | undefined {
  if (o.type === "PARCEL") return ({ PENDING: "CONFIRMED", CONFIRMED: "PICKED_UP", PICKED_UP: "DELIVERED" } as const)[o.status as "PENDING"];
  if (o.fulfillment === "PICKUP" && o.status === "READY") return "DELIVERED";
  return (
    { PENDING: "CONFIRMED", CONFIRMED: "PREPARING", PREPARING: "READY", READY: "PICKED_UP", PICKED_UP: "DELIVERED" } as Partial<
      Record<AdminOrderStatus, AdminOrderStatus>
    >
  )[o.status];
}

// Affiché après chargement des données, côté navigateur : la langue de la page est connue.
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(dateLocale(currentLang()), { dateStyle: "short", timeStyle: "short", timeZone: "UTC" });

// Étapes affichées dans la frise d'une commande, selon son type et son mode de remise.
export function orderSteps(
  o: Pick<AdminOrder, "type" | "fulfillment" | "createdAt" | "confirmedAt" | "preparingAt" | "readyAt" | "pickedUpAt" | "deliveredAt">,
) {
  if (o.type === "PARCEL") {
    return [
      { label: "Nouvelle", at: o.createdAt },
      { label: "Acceptée", at: o.confirmedAt },
      { label: "Ramassé", at: o.pickedUpAt },
      { label: "Livrée", at: o.deliveredAt },
    ];
  }
  const steps = [
    { label: "Nouvelle", at: o.createdAt },
    { label: "Acceptée", at: o.confirmedAt },
    { label: "En cuisine", at: o.preparingAt },
    { label: "Prête", at: o.readyAt },
  ];
  if (o.fulfillment === "DELIVERY") steps.push({ label: "En route", at: o.pickedUpAt });
  steps.push({ label: o.fulfillment === "PICKUP" ? "Remise" : "Livrée", at: o.deliveredAt });
  return steps;
}
