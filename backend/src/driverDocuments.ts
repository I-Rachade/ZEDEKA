import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FileStore } from "./storage.js";
import { HttpError } from "./routes/adminWrite.js";
import { DOCUMENT_KINDS, type DocumentKind } from "./zed.js";
import { checkIdDates, idDatesInput, idStatus } from "./idExpiry.js";
import { firstError } from "./util.js";

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
// idDates : dates de la pièce d'identité, enregistrées avec sa photo (un rappel déjà envoyé repart de zéro).
export async function storeDocuments(
  prisma: PrismaClient,
  files: FileStore | undefined,
  driverId: string,
  photos: Partial<Record<DocumentKind, string>>,
  idDates?: { issuedAt: Date; expiresAt: Date },
) {
  if (!files) throw new HttpError(503, "L'envoi des photos n'est pas disponible pour le moment");
  for (const kind of DOCUMENT_KINDS) {
    const photo = photos[kind];
    if (!photo) continue;
    const { bytes, contentType } = decodePhoto(photo);
    const fileKey = `zed/${driverId}/${kind.toLowerCase()}-${Date.now()}`;
    await files.put(fileKey, bytes, contentType);
    const dates = kind === "ID_CARD" && idDates ? { ...idDates, expiryNotice: null } : {};
    const old = await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId, kind } } });
    if (old) {
      await prisma.zedDocument.update({ where: { id: old.id }, data: { fileKey, createdAt: new Date(), ...dates } });
      await files.delete(old.fileKey).catch(() => {});
    } else {
      await prisma.zedDocument.create({ data: { driverId, kind, fileKey, ...dates } });
    }
  }
}

// Une pièce ajoutée ou remplacée par l'équipe (admin ou adjoint) dans l'admin : seule l'équipe dépose la photo
// de profil, la pièce d'identité et le permis. Pièce d'identité : dates obligatoires ; la photo peut rester la même
// quand on ne corrige que les dates. Rend vrai si la pièce existait déjà.
export const documentInput = z.object({ photo: photoInput.optional(), issuedAt: z.string().optional(), expiresAt: z.string().optional() });
export async function saveDocument(prisma: PrismaClient, files: FileStore | undefined, driverId: string, kind: DocumentKind, body: unknown) {
  const parsed = documentInput.safeParse(body ?? {});
  if (!parsed.success) throw new HttpError(400, firstError(parsed.error));
  let idDates: { issuedAt: Date; expiresAt: Date } | undefined;
  if (kind === "ID_CARD") {
    const dates = idDatesInput.safeParse(parsed.data);
    if (!dates.success) throw new HttpError(400, firstError(dates.error));
    idDates = checkIdDates(dates.data);
  }
  const had = await prisma.zedDocument.findUnique({ where: { driverId_kind: { driverId, kind } }, select: { id: true } });
  if (parsed.data.photo) await storeDocuments(prisma, files, driverId, { [kind]: parsed.data.photo }, idDates);
  else if (had && idDates) await prisma.zedDocument.update({ where: { id: had.id }, data: { ...idDates, expiryNotice: null } });
  else throw new HttpError(400, "Ajoutez la photo");
  return !!had;
}

// Pièces à fournir : absentes, ou pièce d'identité sans dates ou expirée (à renouveler).
export const missingDocuments = (docs: { kind: string; expiresAt?: Date | null }[], now = new Date()) =>
  DRIVER_REQUIRED_DOCUMENTS.filter((k) => {
    const doc = docs.find((d) => d.kind === k);
    if (!doc) return true;
    return k === "ID_CARD" && ["NO_DATES", "EXPIRED"].includes(idStatus(doc.expiresAt, now));
  });

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
