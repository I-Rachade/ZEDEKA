import type { PrismaClient } from "@prisma/client";
import type { FileStore } from "./storage.js";

// Durées de conservation annoncées dans la politique de confidentialité (loi n° 2019-014 : conservation limitée
// à ce qui est nécessaire). Les commandes restent : pièces comptables, 10 ans (Acte uniforme OHADA).
const DAY = 24 * 60 * 60 * 1000;
export const RETENTION_DAYS = {
  codes: 1, // codes de connexion (SMS) et de PIN oublié
  driverLocations: 90, // positions des livreurs pendant les courses
  rejectedApplications: 365, // candidatures refusées (commerces et livreurs sans aucune course)
};

const before = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

// Supprime ce dont la durée de conservation est écoulée ; renvoie le nombre d'éléments effacés par type.
export async function purgeExpiredData(prisma: PrismaClient, files: FileStore, now = new Date()) {
  const codes = before(now, RETENTION_DAYS.codes);
  const rejected = before(now, RETENTION_DAYS.rejectedApplications);
  const [otp, resets, locations] = await Promise.all([
    prisma.otpCode.deleteMany({ where: { createdAt: { lt: codes } } }),
    prisma.passwordReset.deleteMany({ where: { createdAt: { lt: codes } } }),
    prisma.driverLocation.deleteMany({ where: { createdAt: { lt: before(now, RETENTION_DAYS.driverLocations) } } }),
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

  // Candidatures de livreurs refusées, sans aucune trace d'activité.
  const drivers = await prisma.driver.deleteMany({
    where: {
      status: "REJECTED",
      createdAt: { lt: rejected },
      orders: { none: {} },
      assignments: { none: {} },
      issues: { none: {} },
      locations: { none: {} },
      cashCollections: { none: {} },
    },
  });

  return { otp: otp.count, resets: resets.count, locations: locations.count, vendorApplications: applications.length, drivers: drivers.count };
}
