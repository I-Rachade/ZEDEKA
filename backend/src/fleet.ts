import type { PrismaClient } from "@prisma/client";
import { OPEN } from "./orderFlow.js";
import { HttpError } from "./routes/adminWrite.js";

// Parc de motos de Zedeka (livreurs salariés). Le livreur prend une moto libre en passant en ligne, ou l'équipe
// la lui attribue ; il la rend en passant hors ligne. Pendant qu'il l'a, sa plaque (Driver.plate) est celle de la
// moto : la page de suivi et l'écran Zed du client la montrent sans autre changement.

export const motorbikeSelect = { id: true, plate: true, label: true, photoKey: true } as const;

type Driverish = { employment: string; vehicle: string };

// Un salarié à moto doit prendre une moto du parc avant de se mettre en ligne, dès que le parc en compte une
// (tant qu'il est vide, rien ne change pour les livreurs).
export async function needsMotorbike(prisma: PrismaClient, driver: Driverish): Promise<boolean> {
  if (driver.employment !== "STAFF" || driver.vehicle !== "MOTO") return false;
  return (await prisma.motorbike.count({ where: { active: true } })) > 0;
}

// Donne la moto au livreur. Refusée si elle est déjà prise, au garage, ou si le livreur n'est pas salarié.
// Sans transaction (D1) : la moto est réservée par une écriture conditionnelle, un double clic ne la donne pas deux fois.
export async function assignMotorbike(prisma: PrismaClient, motorbikeId: string, driverId: string, assignedBy: string | null, now = new Date()) {
  const [bike, driver] = await Promise.all([
    prisma.motorbike.findUnique({ where: { id: motorbikeId }, select: { id: true, plate: true, active: true, driverId: true } }),
    prisma.driver.findUnique({ where: { id: driverId }, select: { id: true, employment: true, deletedAt: true } }),
  ]);
  if (!bike) throw new HttpError(404, "Moto introuvable");
  if (!driver || driver.deletedAt) throw new HttpError(404, "Livreur introuvable");
  if (driver.employment !== "STAFF") throw new HttpError(409, "Les motos du parc sont pour les livreurs salariés de Zedeka");
  if (bike.driverId === driverId) return bike;
  if (!bike.active) throw new HttpError(409, "Cette moto est retirée du service");
  if (bike.driverId) throw new HttpError(409, "Cette moto vient d'être prise par un autre livreur");
  // Une seule moto à la fois : l'ancienne est rendue d'abord.
  await releaseMotorbike(prisma, driverId, now);
  const claimed = await prisma.motorbike.updateMany({ where: { id: bike.id, driverId: null, active: true }, data: { driverId, assignedAt: now } });
  if (claimed.count === 0) throw new HttpError(409, "Cette moto vient d'être prise par un autre livreur");
  await prisma.motorbikeShift.create({ data: { motorbikeId: bike.id, driverId, startedAt: now, assignedBy } });
  await prisma.driver.update({ where: { id: driverId }, data: { plate: bike.plate } });
  return bike;
}

// Rend la moto du livreur (s'il en a une) : la moto redevient libre et la prise est close.
export async function releaseMotorbike(prisma: PrismaClient, driverId: string, now = new Date()): Promise<boolean> {
  const bike = await prisma.motorbike?.findUnique({ where: { driverId }, select: { id: true } });
  if (!bike) return false;
  await prisma.motorbike.update({ where: { id: bike.id }, data: { driverId: null, assignedAt: null } });
  await prisma.motorbikeShift.updateMany({ where: { motorbikeId: bike.id, driverId, endedAt: null }, data: { endedAt: now } });
  await prisma.driver.update({ where: { id: driverId }, data: { plate: null } });
  return true;
}

// Fin de service : la moto est rendue, sauf si une course est encore en cours (la plaque reste sur la page du client).
export async function releaseAtEndOfShift(prisma: PrismaClient, driverId: string, now = new Date()): Promise<boolean> {
  const open = await prisma.order.count({ where: { driverId, status: { in: OPEN } } });
  if (open > 0) return false;
  return releaseMotorbike(prisma, driverId, now);
}
