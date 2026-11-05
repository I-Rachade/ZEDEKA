import type { PrismaClient } from "@prisma/client";
import type { FileStore } from "./storage.js";
import { deleteZedDocuments } from "./accountDeletion.js";

// Durées de conservation annoncées dans la politique de confidentialité (loi n° 2019-014 : conservation limitée
// à ce qui est nécessaire). Les commandes restent : pièces comptables, 10 ans (Acte uniforme OHADA).
const DAY = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = {
  codes: 1, // codes de connexion (SMS) et de PIN oublié
  driverLocations: 90, // positions des livreurs pendant les courses
  rejectedApplications: 365, // candidatures refusées (commerces et livreurs sans aucune course)
  staffNotifications: 30, // fil des notifications de l'équipe dans l'admin
  supportRequests: 730, // demandes au support : coordonnées et détails effacés 2 ans après leur clôture
};

const before = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

// Supprime ce dont la durée de conservation est écoulée ; renvoie le nombre d'éléments effacés par type.
export async function purgeExpiredData(prisma: PrismaClient, files: FileStore, now = new Date()) {
  const codes = before(now, RETENTION_DAYS.codes);
  const rejected = before(now, RETENTION_DAYS.rejectedApplications);
  const [otp, resets, locations, notifications] = await Promise.all([
    prisma.otpCode.deleteMany({ where: { createdAt: { lt: codes } } }),
    prisma.passwordReset.deleteMany({ where: { createdAt: { lt: codes } } }),
    prisma.driverLocation.deleteMany({ where: { createdAt: { lt: before(now, RETENTION_DAYS.driverLocations) } } }),
    prisma.staffNotification.deleteMany({ where: { createdAt: { lt: before(now, RETENTION_DAYS.staffNotifications) } } }),
  ]);

  // Candidatures de commerces refusées (jamais devenues un restaurant) : fiche et pièces jointes.
  const applications = await prisma.vendorApplication.findMany({
    where: { status: "REJECTED", restaurantId: null, reviewedAt: { lt: rejected } },
    select: { id: true, logoPath: true, coverPath: true, legalDocPath: true },
  });
  for (const a of applications) {
    for (const key of [a.logoPath, a.coverPath, a.legalDocPath]) if (key) await files.delete(key).catch(() => {});
    await prisma.vendorApplication.delete({ where: { id: a.id } });
  }

  // Candidatures de livreurs refusées, sans aucune trace d'activité : photos du dossier Zed comprises.
  const rejectedDrivers = await prisma.driver.findMany({
    where: {
      status: "REJECTED",
      createdAt: { lt: rejected },
      orders: { none: {} },
      assignments: { none: {} },
      issues: { none: {} },
      locations: { none: {} },
      cashCollections: { none: {} },
      zedRides: { none: {} },
      zedPayments: { none: {} },
    },
    select: { id: true },
  });
  for (const d of rejectedDrivers) {
    await deleteZedDocuments(prisma, files, d.id);
    await prisma.driver.delete({ where: { id: d.id } });
  }

  // Dossier Zed refusé d'un livreur qui garde son compte (il livre toujours) : photos effacées, plaque oubliée.
  const zedRejected = await prisma.driver.findMany({
    where: { zedStatus: "REJECTED", zedReviewedAt: { lt: rejected }, OR: [{ zedDocuments: { some: {} } }, { plate: { not: null } }] },
    select: { id: true },
  });
  for (const d of zedRejected) {
    await deleteZedDocuments(prisma, files, d.id);
    await prisma.driver.update({ where: { id: d.id }, data: { plate: null } });
  }

  // Demandes au support closes depuis 2 ans : l'objet reste (statistiques), plus qui ni quoi en détail.
  const closed = { status: "DONE", closedAt: { lt: before(now, RETENTION_DAYS.supportRequests) } };
  const [, support] = await Promise.all([
    prisma.supportRequestNote.deleteMany({ where: { request: closed } }),
    prisma.supportRequest.updateMany({
      where: { ...closed, OR: [{ contactName: { not: null } }, { contactPhone: { not: null } }, { details: { not: null } }] },
      data: { contactName: null, contactPhone: null, details: null },
    }),
  ]);

  return {
    otp: otp.count,
    resets: resets.count,
    locations: locations.count,
    notifications: notifications.count,
    vendorApplications: applications.length,
    drivers: rejectedDrivers.length,
    zedApplications: zedRejected.length,
    supportRequests: support.count,
  };
}
