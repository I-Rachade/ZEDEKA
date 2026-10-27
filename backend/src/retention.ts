import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

// Durées de conservation annoncées dans la politique de confidentialité (loi n° 2019-014 : conservation limitée).
const DAY = 24 * 60 * 60 * 1000;
export const RETENTION = {
  codesMs: DAY, // codes de connexion et de réinitialisation
  driverLocationsMs: 90 * DAY,
  rejectedApplicationsMs: 365 * DAY,
};

export function retentionCutoffs(now = new Date()) {
  return {
    codes: new Date(now.getTime() - RETENTION.codesMs),
    driverLocations: new Date(now.getTime() - RETENTION.driverLocationsMs),
    rejectedApplications: new Date(now.getTime() - RETENTION.rejectedApplicationsMs),
  };
}

// Supprime les données dont la durée de conservation est écoulée. Les commandes restent (comptabilité, 10 ans).
export async function purgeExpiredData(prisma: PrismaClient, uploadDir: string, now = new Date()) {
  const cut = retentionCutoffs(now);
  const [otp, resets, locations] = await Promise.all([
    prisma.otpCode.deleteMany({ where: { createdAt: { lt: cut.codes } } }),
    prisma.passwordReset.deleteMany({ where: { createdAt: { lt: cut.codes } } }),
    prisma.driverLocation.deleteMany({ where: { createdAt: { lt: cut.driverLocations } } }),
  ]);

  // Candidatures de commerces refusées : fiche et pièces jointes.
  const rejected = await prisma.vendorApplication.findMany({
    where: { status: "REJECTED", restaurantId: null, reviewedAt: { lt: cut.rejectedApplications } },
    select: { id: true, reference: true },
  });
  for (const a of rejected) {
    await rm(path.join(uploadDir, "vendor-applications", a.reference), { recursive: true, force: true });
    await prisma.vendorApplication.delete({ where: { id: a.id } });
  }
  // Candidatures de livreurs refusées, sans aucune course.
  const drivers = await prisma.driver.deleteMany({
    where: { status: "REJECTED", createdAt: { lt: cut.rejectedApplications }, orders: { none: {} }, assignments: { none: {} }, issues: { none: {} }, locations: { none: {} }, cashCollections: { none: {} } },
  });

  return { otp: otp.count, resets: resets.count, locations: locations.count, vendorApplications: rejected.length, drivers: drivers.count };
}

export function startRetentionLoop(prisma: PrismaClient, uploadDir: string, everyMs = 6 * 60 * 60 * 1000) {
  const run = () => purgeExpiredData(prisma, uploadDir).catch((e) => console.error("conservation", e));
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return timer;
}
