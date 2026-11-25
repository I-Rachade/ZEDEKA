import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { hashOtp, newOtpCode } from "../customer.js";
import type { EmailSender } from "../email.js";
import { firstError } from "../util.js";

// Mot de passe oublié d'un membre de l'équipe admin (directeur compris) : un code à 6 chiffres part par e-mail
// à l'adresse du compte, puis le membre choisit un nouveau mot de passe. Les sessions ouvertes avec l'ancien
// mot de passe sont fermées (TeamMember.sessionsValidFrom).

const RESET_TTL_MS = 15 * 60_000;
const RESET_MAX_ATTEMPTS = 5;
const RESET_MAX_PER_HOUR = 5;
const ROLE = "team";

const email = z.string().trim().toLowerCase().email("Adresse e-mail invalide").max(120);
export const teamPassword = z.string().min(10, "Mot de passe : 10 caractères minimum").max(200);

type Deps = { prisma: PrismaClient; secret: string; devCodes: boolean; email?: EmailSender };

function resetEmail(code: string, name: string) {
  const minutes = RESET_TTL_MS / 60_000;
  return {
    subject: `Votre code Zedeka admin : ${code}`,
    text: `Bonjour ${name},\n\nVotre code pour choisir un nouveau mot de passe de l'espace admin Zedeka est ${code}. Il est valable ${minutes} minutes.\n\nSi vous ne l'avez pas demandé, ignorez cet e-mail : votre mot de passe ne change pas.`,
  };
}

// À monter avant requireAdmin : on n'est pas encore connecté.
export function adminPasswordRouter(deps: Deps) {
  const { prisma, secret } = deps;
  const router = Router();

  router.post("/password/forgot", async (req, res) => {
    const parsed = z.object({ email }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    // Aucun moyen d'envoyer le code : le dire avant de chercher le compte, pour ne rien révéler.
    if (!deps.email && !deps.devCodes) {
      res.status(503).json({ error: "L'envoi du code par e-mail n'est pas encore activé. Demandez au directeur de changer votre mot de passe dans Équipe." });
      return;
    }
    const member = await prisma.teamMember.findUnique({ where: { email: parsed.data.email } });
    // Même réponse que le compte existe ou non.
    const reply = { ok: true, expiresInMinutes: RESET_TTL_MS / 60_000 };
    if (!member?.active) {
      res.json(reply);
      return;
    }
    const recent = await prisma.passwordReset.count({ where: { role: ROLE, subject: member.id, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } });
    if (recent >= RESET_MAX_PER_HOUR) {
      res.status(429).json({ error: "Trop de demandes. Réessayez dans une heure." });
      return;
    }
    const code = newOtpCode();
    if (deps.email) {
      const { subject, text } = resetEmail(code, member.name);
      try {
        await deps.email.send(member.email, subject, text);
      } catch (err) {
        console.error("envoi de l'e-mail de mot de passe admin", err);
        res.status(502).json({ error: "L'envoi du code a échoué. Réessayez dans un instant." });
        return;
      }
    }
    await prisma.passwordReset.create({
      data: { role: ROLE, subject: member.id, codeHash: hashOtp(`${ROLE}:${member.id}`, code, secret), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    res.json({ ...reply, ...(!deps.email && deps.devCodes ? { devCode: code } : {}) });
  });

  router.post("/password/reset", async (req, res) => {
    const parsed = z.object({ email, code: z.string().trim().regex(/^\d{6}$/, "Le code a 6 chiffres"), password: teamPassword }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: firstError(parsed.error) });
      return;
    }
    const member = await prisma.teamMember.findUnique({ where: { email: parsed.data.email } });
    const reset = member?.active && (await prisma.passwordReset.findFirst({ where: { role: ROLE, subject: member.id, consumedAt: null }, orderBy: { createdAt: "desc" } }));
    if (!member || !reset || reset.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ error: "Code expiré. Demandez-en un nouveau." });
      return;
    }
    if (reset.attempts >= RESET_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Trop d'essais. Demandez un nouveau code." });
      return;
    }
    // Essai compté avant la comparaison, par la base : des essais envoyés en même temps comptent chacun.
    const { attempts } = await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
    if (attempts > RESET_MAX_ATTEMPTS) {
      res.status(429).json({ error: "Trop d'essais. Demandez un nouveau code." });
      return;
    }
    if (reset.codeHash !== hashOtp(`${ROLE}:${member.id}`, parsed.data.code, secret)) {
      res.status(400).json({ error: "Code incorrect" });
      return;
    }
    await prisma.passwordReset.updateMany({ where: { role: ROLE, subject: member.id, consumedAt: null }, data: { consumedAt: new Date() } });
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { passwordHash: await bcrypt.hash(parsed.data.password, 10), sessionsValidFrom: new Date() },
    });
    res.json({ ok: true });
  });

  return router;
}
