import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

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

// Routes des tables, partagées par l'espace restaurant (/tables, restaurant connecté) et l'admin
// (/restaurants/:id/tables). `restaurantOf` donne le restaurant visé, ou null s'il n'existe pas.
export function tablesRouter(prisma: PrismaClient, restaurantOf: (req: Request, res: Response) => Promise<string | null> | string | null) {
  const router = Router({ mergeParams: true });
  const resolve = async (req: Request, res: Response) => {
    const id = await restaurantOf(req, res);
    if (!id) res.status(404).json({ error: "Restaurant introuvable" });
    return id;
  };

  router.get("/", async (req, res) => {
    const id = await resolve(req, res);
    if (id) res.json(await listTables(prisma, id));
  });

  router.post("/", async (req, res) => {
    const id = await resolve(req, res);
    if (!id) return;
    const parsed = z.object({ count: z.number().int().min(1).max(50) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Indiquez un nombre de tables entre 1 et 50" });
      return;
    }
    const tables = await addTables(prisma, id, parsed.data.count);
    if (!tables) {
      res.status(400).json({ error: `${MAX_TABLES} tables au maximum` });
      return;
    }
    res.status(201).json(tables);
  });

  // Nouveau QR code pour une table (ancien code perdu ou recopié) : l'ancien lien ne marche plus.
  router.post("/:tableId/renew", async (req, res) => {
    const id = await resolve(req, res);
    if (!id) return;
    const table = await prisma.restaurantTable.findFirst({ where: { id: req.params.tableId, restaurantId: id } });
    if (!table) {
      res.status(404).json({ error: "Table introuvable" });
      return;
    }
    await prisma.restaurantTable.update({ where: { id: table.id }, data: { token: newTableToken() } });
    res.json(await listTables(prisma, id));
  });

  router.delete("/:tableId", async (req, res) => {
    const id = await resolve(req, res);
    if (!id) return;
    const { count } = await prisma.restaurantTable.deleteMany({ where: { id: req.params.tableId, restaurantId: id } });
    if (!count) {
      res.status(404).json({ error: "Table introuvable" });
      return;
    }
    res.json(await listTables(prisma, id));
  });

  return router;
}
