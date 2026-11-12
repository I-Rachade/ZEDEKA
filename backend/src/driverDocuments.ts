import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FileStore } from "./storage.js";
import { HttpError } from "./routes/adminWrite.js";
import { DOCUMENT_KINDS, type DocumentKind } from "./zed.js";

// Pièces de tous les livreurs et conducteurs (table ZedDocument, née avec le mode Zed) :
// SELFIE (photo de profil, montrée au client), ID_CARD et LICENCE (vues par l'équipe seulement),
// MOTO (photo de sa moto, pour un livreur indépendant).

export const MAX_PHOTO_BYTES = 1_500_000;
// Photos envoyées par l'appli (data URL JPEG, PNG ou WebP, réduites sur le téléphone).
export const photoInput = z.string().max(2_200_000).regex(/^data:image\/(jpeg|png|webp);base64,/, "Photo illisible");
export const plateInput = z.string().trim().toUpperCase().min(3, "Indiquez la plaque de la moto").max(20);
// Pièces attendues de chaque livreur : photo de profil et pièce d'identité (le permis s'ajoute pour le mode Zed).
export const DRIVER_REQUIRED_DOCUMENTS: DocumentKind[] = ["SELFIE", "ID_CARD"];

export function decodePhoto(dataUrl: string): { bytes: Uint8Array; contentType: string } {
  const [head, b64] = dataUrl.split(",", 2);
  const contentType = head.slice(5, head.indexOf(";"));
  const bin = atob(b64 ?? "");
  if (bin.length > MAX_PHOTO_BYTES) throw new HttpError(413, "Photo trop lourde (1,5 Mo au plus)");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, contentType };
}

// Enregistre (ou remplace) les photos données ; l'ancienne photo d'une même pièce est effacée.
export async function storeDocuments(prisma: PrismaClient, files: FileStore | undefined, driverId: string, photos: Partial<Record<DocumentKind, string>>) {
  if (!files) throw new HttpError(503, "L'envoi des photos n'est pas disponible pour le moment");
  for (const kind of DOCUMENT_KINDS) {
    const photo = photos[kind];
    if (!photo) continue;
    const { bytes, contentType } = decodePhoto(photo);
    const fileKey = `zed/${driverId}/${kind.toLowerCase()}-${Date.now()}`;
    await files.put(fileKey, bytes, contentType);
    const old = await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId, kind } } });
    if (old) {
      await prisma.zedDocument.update({ where: { id: old.id }, data: { fileKey, createdAt: new Date() } });
      await files.delete(old.fileKey).catch(() => {});
    } else {
      await prisma.zedDocument.create({ data: { driverId, kind, fileKey } });
    }
  }
}

export const missingDocuments = (kinds: string[]) => DRIVER_REQUIRED_DOCUMENTS.filter((k) => !kinds.includes(k));

// --- Photo de profil montrée au client ---
// Lien signé et limité dans le temps : la page de suivi (ou l'écran Zed) l'affiche dans une balise <img>, sans
// en-tête d'authentification. Seule la photo de profil est servie ainsi, jamais les pièces.

const PHOTO_LINK_MS = 6 * 3_600_000;
const HOUR = 3_600_000;
const photoSig = (secret: string, driverId: string, exp: number) => createHmac("sha256", secret).update(`driver-photo:${driverId}:${exp}`).digest("base64url").slice(0, 32);

// L'expiration est arrondie à l'heure : le même lien revient d'un rafraîchissement à l'autre (cache du navigateur).
export function driverPhotoUrl(secret: string, driverId: string, now = Date.now()): string {
  const exp = Math.ceil((now + PHOTO_LINK_MS) / HOUR) * HOUR;
  return `/api/driver-photo/${driverId}.${exp.toString(36)}.${photoSig(secret, driverId, exp)}`;
}

export function readDriverPhotoToken(secret: string, token: string, now = Date.now()): string | null {
  const [driverId, exp36, sig] = token.split(".");
  if (!driverId || !exp36 || !sig || !secret) return null;
  const exp = parseInt(exp36, 36);
  if (!Number.isFinite(exp) || exp < now) return null;
  const expected = Buffer.from(photoSig(secret, driverId, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? driverId : null;
}

// Photo de profil du livreur pour le client : lien signé s'il en a une.
export async function driverPhotoFor(prisma: PrismaClient, secret: string, driverId: string): Promise<string | null> {
  const doc = await Promise.resolve()
    .then(() => prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId, kind: "SELFIE" } }, select: { id: true } }))
    .catch(() => null);
  return doc ? driverPhotoUrl(secret, driverId) : null;
}
