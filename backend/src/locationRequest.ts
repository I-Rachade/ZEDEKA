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

// 128 bits aléatoires (22 caractères) : impossible à deviner. Seule l'empreinte est gardée en base.
export function newLocationToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashLocationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const isTokenShape = (token: string) => /^[A-Za-z0-9_-]{22}$/.test(token);

// Le lien sert encore : demande ni expirée ni remplacée, colis pas encore récupéré.
export function linkUsable(request: { status: string; expiresAt: Date }, orderStatus: string, now: Date): boolean {
  return OPEN_REQUEST.includes(request.status) && request.expiresAt > now && !CLOSED_ORDER.includes(orderStatus);
}

// État montré à l'expéditeur, au suivi et à l'admin (jamais les coordonnées).
export function locationStatus(request: { status: string; expiresAt: Date } | null, orderStatus: string, now: Date): string | null {
  if (!request) return null;
  if (request.status === "SHARED" || request.status === "DECLINED") return request.status;
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

export function locationLink(origin: string, token: string, o: { customerName: string; recipientName: string | null; recipientPhone: string | null }, expiresAt: Date) {
  const url = `${origin.replace(/\/$/, "")}/position/${token}`;
  const hello = o.recipientName ? `Bonjour ${firstName(o.recipientName)}, ` : "Bonjour, ";
  const text = `${hello}${firstName(o.customerName)} vous envoie un colis avec Zedeka. Pour que le livreur vous trouve facilement, partagez votre position ici (lien valable 24 h) : ${url}`;
  const phone = o.recipientPhone ? normalizePhone(o.recipientPhone) : null;
  const whatsappUrl = `https://wa.me/${phone ? phone.slice(1) : ""}?text=${encodeURIComponent(text)}`;
  return { url, whatsappUrl, expiresAt: expiresAt.toISOString() };
}

// Nouveau lien pour la commande : remplace le précédent, qui cesse de marcher.
export async function issueLocationLink(prisma: PrismaClient, orderId: string, now: Date) {
  const token = newLocationToken();
  const expiresAt = new Date(now.getTime() + LOCATION_LINK_TTL_MS);
  const data = { tokenHash: hashLocationToken(token), status: "PENDING", expiresAt, openedAt: null, createdAt: now };
  await prisma.locationRequest.upsert({ where: { orderId }, create: { orderId, ...data }, update: data });
  return { token, expiresAt };
}

// Tâche planifiée : liens échus ou colis récupérés passent en EXPIRED ; coordonnées du destinataire
// effacées 30 jours après la fin de la commande.
export async function sweepLocationRequests(prisma: PrismaClient, now = new Date()) {
  await prisma.locationRequest.updateMany({
    where: { status: { in: ["PENDING", "OPENED"] }, OR: [{ expiresAt: { lt: now } }, { order: { status: { in: CLOSED_ORDER as never[] } } }] },
    data: { status: "EXPIRED" },
  });
  const before = new Date(now.getTime() - RECIPIENT_POSITION_RETENTION_MS);
  const old = { locationSource: "RECIPIENT", OR: [{ deliveredAt: { lt: before } }, { cancelledAt: { lt: before } }] };
  await prisma.order.updateMany({ where: { ...old, latitude: { not: null } }, data: { latitude: null, longitude: null } });
  await prisma.locationRequest.updateMany({ where: { order: old, OR: [{ accuracyM: { not: null } }, { landmark: { not: null } }] }, data: { accuracyM: null, landmark: null } });
}
