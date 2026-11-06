import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getSettings } from "../util.js";
import { HttpError, write } from "./adminWrite.js";
import { invalidateServices, listModules, MODULE_CODES, MODULES, NOT_BUILT } from "../services.js";
import type { Staff } from "../team.js";

const stateInput = z.object({ state: z.enum(["ON", "SOON", "OFF"]) });
const orderInput = z.object({ codes: z.array(z.enum(MODULE_CODES)).min(1).max(MODULES.length) });

// Page « Services » de l'admin : activer, annoncer (« Bientôt ») ou cacher chaque module, et choisir l'ordre.
// Lecture pour l'adjoint, changements réservés au directeur (team.ts).
export function adminServicesRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/services", async (_req, res) => {
    res.json(await listModules(prisma));
  });

  router.patch(
    "/services/:id",
    write(stateInput, async ({ state }, code, res) => {
      if (!state) throw new HttpError(400, "Choisissez un état");
      const def = MODULES.find((m) => m.code === code);
      if (!def) throw new HttpError(404, "Service inconnu");
      if (state === "ON" && !def.built) throw new HttpError(400, NOT_BUILT);
      const by = (res.locals.staff as Staff | undefined)?.name ?? null;
      // La course Zed garde une seule source : le réglage « Mode Zed ».
      if (code === "RIDE") {
        await getSettings(prisma);
        await prisma.settings.update({ where: { id: 1 }, data: { zedEnabled: state === "ON" } });
      }
      const index = MODULES.indexOf(def);
      await prisma.serviceModule.upsert({ where: { code }, update: { state, updatedBy: by }, create: { code, state, sortOrder: index * 10, updatedBy: by } });
      invalidateServices();
      return (await listModules(prisma)).find((m) => m.code === code);
    }, { partial: true }),
  );

  // Nouvel ordre de la feuille : la liste complète ou partielle des codes, du premier au dernier.
  router.put(
    "/services/order",
    write(orderInput, async ({ codes }) => {
      if (!codes?.length) throw new HttpError(400, "Liste des services manquante");
      const current = await listModules(prisma);
      const rest = current.map((m) => m.code).filter((c) => !codes.includes(c));
      const ordered = [...new Set(codes), ...rest];
      await Promise.all(
        ordered.map((code, i) => {
          const def = current.find((m) => m.code === code)!;
          return prisma.serviceModule.upsert({ where: { code }, update: { sortOrder: i * 10 }, create: { code, state: def.state, sortOrder: i * 10 } });
        }),
      );
      invalidateServices();
      return listModules(prisma);
    }, { partial: true }),
  );

  return router;
}
