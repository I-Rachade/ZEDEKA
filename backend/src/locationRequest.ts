import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizePhone } from "./customer.js";

// Demande de position au destinataire d'un colis : l'expéditeur lui envoie un lien, le destinataire accepte
// et sa position devient le point de livraison. Le lien ne donne rien à lire : il permet seulement de déposer
// une position pour ce colis, pendant 24 h au plus et tant que le livreur n'a pas récupéré le colis.

export const LOCATION_LINK_TTL_MS = 24 * 60 * 60 * 1000;
// Coordonnées du destinataire effacées après ce délai, une fois la commande terminée.
export const RECIPIENT_POSITION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Adresse enregistrée quand l'expéditeur laisse le destinataire donner sa position.
export const ADDRESS_FROM_RECIPIENT = "Position demandée au destinataire";

const CLOSED_ORDER = ["PICKED_UP", "DELIVERED", "CANCELLED"];
const OPEN_REQUEST = ["PENDING", "OPENED", "SHARED", "DECLINED"];
// Demande sans position (pas de réponse, ou refus) : la commande attend la position, et donc son prix,
// avant d'être confiée à un livreur. L'expéditeur peut aussi placer le point lui-même depuis le suivi.
export const AWAITING = ["PENDING", "OPENED", "DECLINED"];
export const AWAITING_REASON = "Position du destinataire non reçue dans les 24 heures";

export const awaitingPosition = (request: { status: string } | null | undefined) => !!request && AWAITING.includes(request.status);

// 128 bits aléatoires (22 caractères) : impossible à deviner. Seule l'empreinte est gardée en base.
export function newLocationToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashLocationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const isTokenShape = (token: string) => /^[A-Za-z0-9_-]{22}$/.test(token);

// Le lien sert encore : demande ni expirée ni remplacée, colis pas encore récupéré (ou commande pas encore passée).
export function linkUsable(request: { status: string; expiresAt: Date }, orderStatus: string | null, now: Date): boolean {
  return OPEN_REQUEST.includes(request.status) && request.expiresAt > now && !(orderStatus && CLOSED_ORDER.includes(orderStatus));
}

// État montré à l'expéditeur, au suivi et à l'admin (jamais les coordonnées).
export function locationStatus(request: { status: string; expiresAt: Date } | null, orderStatus: string, now: Date): string | null {
  // REVOKED : l'expéditeur a placé le point lui-même, la demande ne compte plus.
  if (!request || request.status === "REVOKED") return null;
  if (request.status === "SHARED") return request.status;
  if (request.status === "DECLINED") return linkUsable(request, orderStatus, now) ? "DECLINED" : "EXPIRED";
  return linkUsable(request, orderStatus, now) ? "PENDING" : "EXPIRED";
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

// Le repère du destinataire complète l'adresse vue par le livreur.
export function addressWithLandmark(address: string, landmark: string | undefined): string {
  if (!landmark) return address;
  if (address === ADDRESS_FROM_RECIPIENT || address.trim() === "") return `Repère : ${landmark}`;
  const cleaned = address.replace(/ · Repère : .*$/, "");
  return `${cleaned} · Repère : ${landmark}`.slice(0, 300);
}

// Lien et message prêts à copier : l'expéditeur les envoie lui-même, par le moyen de son choix.
export function locationLink(origin: string, token: string, o: { customerName: string; recipientName: string | null; recipientPhone?: string | null }, expiresAt: Date) {
  const url = `${origin.replace(/\/$/, "")}/position/${token}`;
  const hello = o.recipientName ? `Bonjour ${firstName(o.recipientName)}, ` : "Bonjour, ";
  const text = `${hello}${firstName(o.customerName)} vous envoie un colis avec Zedeka. Pour que le livreur vous trouve facilement, partagez votre position ici (lien valable 24 h) : ${url}`;
  const phone = o.recipientPhone ? normalizePhone(o.recipientPhone) : null;
  const whatsappUrl = `https://wa.me/${phone ? phone.slice(1) : ""}?text=${encodeURIComponent(text)}`;
  return { url, text, whatsappUrl, expiresAt: expiresAt.toISOString() };
}

// Demande créée avant la commande : le lien pour le destinataire, et une clé que seul l'expéditeur garde pour
// suivre la réponse (compte à rebours du formulaire) puis la joindre à sa commande.
export async function issueStandaloneLink(prisma: PrismaClient, who: { senderName: string; recipientName: string | null }, now: Date) {
  const token = newLocationToken();
  const pollKey = newLocationToken();
  const expiresAt = new Date(now.getTime() + LOCATION_LINK_TTL_MS);
  await prisma.locationRequest.create({
    data: { tokenHash: hashLocationToken(token), pollKeyHash: hashLocationToken(pollKey), senderName: who.senderName, recipientName: who.recipientName, expiresAt, createdAt: now },
  });
  return { token, pollKey, expiresAt };
}

// Nouveau lien pour la commande : remplace le précédent, qui cesse de marcher.
export async function issueLocationLink(prisma: PrismaClient, orderId: string, now: Date) {
  const token = newLocationToken();
  const expiresAt = new Date(now.getTime() + LOCATION_LINK_TTL_MS);
  const data = { tokenHash: hashLocationToken(token), status: "PENDING", expiresAt, openedAt: null, createdAt: now };
  await prisma.locationRequest.upsert({ where: { orderId }, create: { orderId, ...data }, update: data });
  return { token, expiresAt };
}

// Tâche planifiée : commande annulée sans frais si le destinataire n'a pas répondu dans les 24 h ; liens échus
// passent en EXPIRED ; coordonnées du destinataire effacées 30 jours après la fin de la commande.
export async function sweepLocationRequests(prisma: PrismaClient, now = new Date()) {
  // Demandes jamais jointes à une commande : effacées, position comprise, une fois le lien échu.
  await prisma.locationRequest.deleteMany({ where: { orderId: null, expiresAt: { lt: now } } });
  const unanswered = { status: { in: AWAITING }, expiresAt: { lt: now } };
  await prisma.order.updateMany({
    where: { status: "PENDING", locationRequest: unanswered },
    data: { status: "CANCELLED", cancelledAt: now, cancellationReason: AWAITING_REASON, cancellationFee: 0 },
  });
  await prisma.locationRequest.updateMany({
    where: { status: { in: AWAITING }, OR: [{ expiresAt: { lt: now } }, { order: { status: { in: CLOSED_ORDER as never[] } } }] },
    data: { status: "EXPIRED" },
  });
  const before = new Date(now.getTime() - RECIPIENT_POSITION_RETENTION_MS);
  const old = { locationSource: "RECIPIENT", OR: [{ deliveredAt: { lt: before } }, { cancelledAt: { lt: before } }] };
  await prisma.order.updateMany({ where: { ...old, latitude: { not: null } }, data: { latitude: null, longitude: null } });
  await prisma.locationRequest.updateMany({ where: { order: old, OR: [{ accuracyM: { not: null } }, { landmark: { not: null } }] }, data: { accuracyM: null, landmark: null } });
}
