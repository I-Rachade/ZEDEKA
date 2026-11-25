import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { HttpError, write } from "./adminWrite.js";
import type { Staff } from "../team.js";
import { deleteTeamMember } from "../accountDeletion.js";

// Comptes de l'équipe (directeur seulement, voir dispatcherMay).

const memberInput = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(120),
  password: z.string().min(10, "Mot de passe : 10 caractères minimum").max(200),
  role: z.enum(["DIRECTOR", "DEPUTY", "MANAGER", "DISPATCHER", "HR", "ACCOUNTANT"]).default("DISPATCHER"),
  active: z.boolean().default(true),
});

const memberSelect = { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, createdAt: true } as const;

// onMemberLeft : prévient le parc mobile quand un membre est désactivé ou supprimé (téléphones d'entreprise verrouillés).
type TeamOptions = { onMemberLeft?: (member: { email: string | null; name: string }) => Promise<unknown> };

export function adminTeamRouter(prisma: PrismaClient, options: TeamOptions = {}) {
  const left = (m: { email: string | null; name: string } | null) => (m && options.onMemberLeft ? options.onMemberLeft(m).catch(() => {}) : undefined);
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
        if (me.id === id && (data.active === false || (data.role !== undefined && data.role !== "DIRECTOR"))) {
          throw new HttpError(409, "Vous ne pouvez pas retirer vos propres droits de directeur");
        }
        const before = data.active === false ? await prisma.teamMember.findUnique({ where: { id }, select: { active: true, email: true, name: true } }) : null;
        const updated = await prisma.teamMember.update({
          where: { id },
          // Mot de passe changé par le directeur : les sessions déjà ouvertes de ce membre sont fermées.
          data: { ...data, ...(password ? { passwordHash: await bcrypt.hash(password, 10), ...(me.id === id ? {} : { sessionsValidFrom: new Date() }) } : {}) },
          select: memberSelect,
        });
        if (before?.active) await left(before);
        return updated;
      },
      { partial: true },
    ),
  );

  // Supprimer un ancien membre : son nom reste écrit dans ce qu'il a fait (demandes, validations).
  router.delete("/team/:id", async (req, res) => {
    const member = await prisma.teamMember.findUnique({ where: { id: String(req.params.id) }, select: { active: true, email: true, name: true } });
    const result = await deleteTeamMember(prisma, String(req.params.id), (res.locals.staff as Staff).id);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    if (member?.active) await left(member);
    res.status(204).end();
  });

  return router;
}
