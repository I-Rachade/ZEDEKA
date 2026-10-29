import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";
import type { Staff } from "../team.js";

// Comptes de l'équipe (directeur seulement, voir dispatcherMay).

const memberInput = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(120),
  password: z.string().min(10, "Mot de passe : 10 caractères minimum").max(200),
  role: z.enum(["DIRECTOR", "DISPATCHER"]).default("DISPATCHER"),
  active: z.boolean().default(true),
});

const memberSelect = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true } as const;

export function adminTeamRouter(prisma: PrismaClient) {
  const router = Router();

  router.get("/team", async (_req, res) => {
    res.json(await prisma.teamMember.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }], select: memberSelect }));
  });

  router.post(
    "/team",
    write(memberInput, async ({ password, ...data }) =>
      prisma.teamMember.create({ data: { ...data, passwordHash: await bcrypt.hash(password, 10) }, select: memberSelect }),
    ),
  );

  router.patch(
    "/team/:id",
    write(
      memberInput,
      async ({ password, ...data }, id, res) => {
        const me = res.locals.staff as Staff;
        if (me.id === id && (data.active === false || data.role === "DISPATCHER")) {
          throw new HttpError(409, "Vous ne pouvez pas retirer vos propres droits de directeur");
        }
        return prisma.teamMember.update({
          where: { id },
          data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
          select: memberSelect,
        });
      },
      { partial: true },
    ),
  );

  return router;
}
