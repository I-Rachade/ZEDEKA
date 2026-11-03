import type { PrismaClient } from "@prisma/client";
import { OPEN } from "./orderFlow.js";
import type { FileStore } from "./storage.js";
import { RIDE_OPEN, RIDE_WITH_DRIVER } from "./zed.js";

// Suppression des comptes : ce qui est effacé, ce qui reste pour la comptabilité (10 ans, Acte uniforme OHADA)
// et sans plus aucun lien avec la personne. Promis par la politique de confidentialité et la page
// « Supprimer mes données » (frontend/src/components/legal).

export type DeletionResult = { ok: true; kept: boolean } | { ok: false; status: number; error: string };

// Ce qui reste d'une commande d'un client qui a supprimé son compte : montants, dates, restaurant, plats.
export const DELETED_CUSTOMER_NAME = "Client supprimé";
const ANONYMOUS_ORDER = {
  customerName: DELETED_CUSTOMER_NAME,
  customerPhone: "",
  address: "",
  latitude: null,
  longitude: null,
  note: null,
  pickupAddress: null,
  pickupLatitude: null,
  pickupLongitude: null,
  recipientName: null,
  recipientPhone: null,
  ratingComment: null,
  receiptDisputeNote: null,
};

// Client (depuis son profil). Refusé tant qu'une commande ou un Zed est en cours : le livreur et le restaurant
// ont encore besoin du numéro et de l'adresse. Ensuite : compte anonymisé, adresses et abonnements effacés,
// commandes et courses Zed gardées sans nom, numéro, adresse ni position.
export async function deleteCustomerAccount(prisma: PrismaClient, id: string): Promise<DeletionResult> {
  const [orders, rides] = await Promise.all([
    prisma.order.count({ where: { customerId: id, status: { in: OPEN } } }),
    prisma.zedRide.count({ where: { customerId: id, status: { in: [...RIDE_OPEN] } } }),
  ]);
  if (orders > 0) return { ok: false, status: 409, error: "Une commande est en cours. Attendez sa livraison ou annulez-la avant de supprimer votre compte." };
  if (rides > 0) return { ok: false, status: 409, error: "Un Zed est en cours. Terminez ou annulez la course avant de supprimer votre compte." };
  await prisma.$transaction([
    prisma.customerAddress.deleteMany({ where: { customerId: id } }),
    prisma.pushSubscription.deleteMany({ where: { role: "customer", subject: id } }),
    // Les commandes restent rattachées au compte anonyme : détachées, linkHistory les rendrait au prochain
    // compte créé avec le même numéro.
    prisma.order.updateMany({ where: { customerId: id }, data: ANONYMOUS_ORDER }),
    // Position de prise en charge : colonnes obligatoires, ramenées à 0.
    prisma.zedRide.updateMany({ where: { customerId: id }, data: { latitude: 0, longitude: 0, accuracy: null, landmark: null, ratingComment: null } }),
    prisma.customer.update({ where: { id }, data: { phone: `supprime:${id}`, name: null, email: null, pinHash: null, deletedAt: new Date() } }),
  ]);
  return { ok: true, kept: true };
}

// Photos du dossier Zed (selfie, pièce d'identité, permis, moto) : fichiers et lignes effacés.
export async function deleteZedDocuments(prisma: PrismaClient, files: FileStore | undefined, driverId: string) {
  const docs = await prisma.zedDocument.findMany({ where: { driverId }, select: { fileKey: true } });
  for (const d of docs) await files?.delete(d.fileKey).catch(() => {});
  await prisma.zedDocument.deleteMany({ where: { driverId } });
}

// Livreur ou conducteur Zed (depuis l'admin ou depuis son profil). Refusé tant qu'il a une course ou un Zed en
// cours, ou des espèces à remettre. Sans aucun historique, il est effacé ; sinon le compte est fermé et ses
// coordonnées, PIN, positions, plaque et photos du dossier Zed effacées, mais la ligne garde son nom pour les
// commandes passées, les remises d'espèces, les paiements du plan Zed et les rapports.
export async function deleteDriverAccount(prisma: PrismaClient, files: FileStore | undefined, id: string, by: "admin" | "self"): Promise<DeletionResult> {
  const driver = await prisma.driver.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!driver || driver.deletedAt) return { ok: false, status: 404, error: "Livreur introuvable" };
  const self = by === "self";
  const [ongoing, rides, cashDue, orders, history] = await Promise.all([
    prisma.order.count({ where: { driverId: id, status: { in: OPEN } } }),
    prisma.zedRide.count({ where: { driverId: id, status: { in: [...RIDE_WITH_DRIVER] } } }),
    prisma.order.count({ where: { driverId: id, status: "DELIVERED", paymentMethod: "CASH", cashCollectionId: null } }),
    prisma.order.count({ where: { driverId: id } }),
    Promise.all([
      prisma.driverAssignment.count({ where: { driverId: id } }),
      prisma.cashCollection.count({ where: { driverId: id } }),
      prisma.driverIssue.count({ where: { driverId: id } }),
      prisma.zedRide.count({ where: { driverId: id } }),
      prisma.zedPayment.count({ where: { driverId: id, amount: { gt: 0 } } }),
    ]),
  ]);
  if (ongoing > 0 || rides > 0) {
    return {
      ok: false,
      status: 409,
      error: self ? "Vous avez une course en cours. Terminez-la avant de supprimer votre compte." : "Ce livreur a une course en cours. Réattribuez-la ou terminez-la avant de le supprimer.",
    };
  }
  if (cashDue > 0) {
    return {
      ok: false,
      status: 409,
      error: self ? "Vous avez encore des espèces à remettre. Remettez-les à Zedeka avant de supprimer votre compte." : "Ce livreur a encore des espèces à remettre. Enregistrez la remise dans Finances avant de le supprimer.",
    };
  }
  await deleteZedDocuments(prisma, files, id);
  await prisma.driverLocation.deleteMany({ where: { driverId: id } });
  // Téléphones abonnés aux notifications : désabonnés dans les deux cas.
  await prisma.pushSubscription.deleteMany({ where: { role: "driver", subject: id } });
  if (orders === 0 && history.every((n) => n === 0)) {
    // Alertes Zed et essais gratuits partent avec (ON DELETE CASCADE).
    await prisma.driver.delete({ where: { id } });
    return { ok: true, kept: false };
  }
  const now = new Date();
  await prisma.zedOffer.deleteMany({ where: { driverId: id } });
  await prisma.driver.update({
    where: { id },
    data: {
      deletedAt: now,
      active: false,
      online: false,
      // Numéro libéré (il est unique) : la personne pourra se réinscrire plus tard.
      phone: `supprime-${id}`,
      email: null,
      pinHash: null,
      pinAttempts: 0,
      pinLockedUntil: null,
      pinResetUntil: null,
      sessionsValidFrom: now,
      lastLatitude: null,
      lastLongitude: null,
      lastLocationAt: null,
      lastSeenAt: null,
      monthlySalary: null,
      zedAvailable: false,
      plate: null,
      zedNote: null,
    },
  });
  return { ok: true, kept: true };
}

// Dossier de candidature d'un restaurant supprimé : fichiers envoyés (logo, couverture, pièce légale) effacés,
// coordonnées du gérant, mobile money, RCCM, NIF et mot de passe vidés. Restent la référence et le nom du commerce.
export async function eraseVendorApplication(prisma: PrismaClient, files: FileStore | undefined, restaurantId: string) {
  const a = await prisma.vendorApplication.findUnique({ where: { restaurantId }, select: { id: true, logoPath: true, coverPath: true, legalDocPath: true } });
  if (!a) return;
  for (const key of [a.logoPath, a.coverPath, a.legalDocPath]) if (key) await files?.delete(key).catch(() => {});
  await prisma.vendorApplication.update({
    where: { id: a.id },
    data: {
      address: "",
      latitude: null,
      longitude: null,
      logoPath: "",
      coverPath: "",
      legalDocPath: null,
      ownerFirstName: "",
      ownerLastName: "",
      phone: "",
      whatsapp: null,
      momoNumber: "",
      rccm: null,
      nif: null,
      email: "",
      passwordHash: "",
    },
  });
}

// Membre de l'équipe Zedeka (directeur seulement). Son nom reste écrit tel quel dans les demandes et les
// validations qu'il a faites ; son compte, ses réglages de notification et ses abonnements sont effacés.
export async function deleteTeamMember(prisma: PrismaClient, id: string, actorId: string | null | undefined): Promise<DeletionResult> {
  if (id === actorId) return { ok: false, status: 409, error: "Vous ne pouvez pas supprimer votre propre compte" };
  const member = await prisma.teamMember.findUnique({ where: { id }, select: { id: true } });
  if (!member) return { ok: false, status: 404, error: "Membre introuvable" };
  await prisma.pushSubscription.deleteMany({ where: { role: "admin", subject: id } });
  await prisma.staffNotificationPrefs.deleteMany({ where: { subject: id } });
  await prisma.teamMember.delete({ where: { id } });
  return { ok: true, kept: false };
}
