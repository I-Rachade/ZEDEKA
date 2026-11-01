import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// Tables numérotées d'un restaurant. Le QR code de chaque table pointe vers /t/<token> : le gérant l'imprime et le pose
// sur la table ; le client commande sur place, la commande arrive dans l'espace restaurant avec le numéro de la table.

export const MAX_TABLES = 200;

// 12 caractères aléatoires (72 bits) : impossible de deviner le lien d'une autre table ou d'un autre restaurant.
export const newTableToken = () => randomBytes(9).toString("base64url");

export const isTableToken = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{12}$/.test(t);

// Ajoute `count` tables à la suite des numéros existants (1, 2, 3… puis 4, 5…).
export async function addTables(prisma: PrismaClient, restaurantId: string, count: number) {
  const existing = await prisma.restaurantTable.findMany({ where: { restaurantId }, select: { number: true } });
  if (existing.length + count > MAX_TABLES) return null;
  const start = existing.reduce((m, t) => Math.max(m, t.number), 0) + 1;
  for (let i = 0; i < count; i++) {
    await prisma.restaurantTable.create({ data: { restaurantId, number: start + i, token: newTableToken() } });
  }
  return listTables(prisma, restaurantId);
}

export const listTables = (prisma: PrismaClient, restaurantId: string) =>
  prisma.restaurantTable.findMany({ where: { restaurantId }, orderBy: { number: "asc" }, select: { id: true, number: true, token: true } });

// Libellé de l'adresse d'une commande sur place.
export const tableAddress = (number: number, restaurantName: string) => `Sur place, table ${number} chez ${restaurantName}`;
