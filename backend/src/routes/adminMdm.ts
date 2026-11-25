import { createHmac, randomUUID } from "node:crypto";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Staff } from "../team.js";

// Parc mobile (MDM) : console de gestion des téléphones et tablettes de l'équipe (dossier mdm/ du dépôt,
// Worker zedeka-mdm). Le back-office ouvre la console sans second mot de passe : il signe un jeton d'une minute,
// à usage unique, avec le secret MDM_SSO_SECRET partagé entre les deux Workers.
export type MdmConfig = { url: string; ssoSecret: string };

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function signMdmToken(secret: string, claims: Record<string, unknown>, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: "zedeka", aud: "mdm", iat, exp: iat + 60, jti: randomUUID(), ...claims }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

export function adminMdmRouter(prisma: PrismaClient, mdm: MdmConfig | undefined) {
  const router = Router();

  // Réservé au directeur et à l'administrateur adjoint (verrouillage et effacement des téléphones).
  router.post("/mdm/session", async (_req, res) => {
    const staff = res.locals.staff as Staff;
    if (staff.role !== "DIRECTOR" && staff.role !== "DEPUTY") {
      res.status(403).json({ error: "Réservé au directeur" });
      return;
    }
    if (!mdm?.url || !mdm.ssoSecret || mdm.ssoSecret.length < 32) {
      res.status(503).json({ error: "Parc mobile pas encore installé (secret MDM_SSO_SECRET absent)" });
      return;
    }
    const member = staff.id ? await prisma.teamMember.findUnique({ where: { id: staff.id }, select: { email: true } }) : null;
    const accessEmail: string | undefined = res.locals.accessEmail;
    const email = (member?.email ?? accessEmail ?? "direction@zedeka.invalid").toLowerCase();
    const token = signMdmToken(mdm.ssoSecret, { email, name: staff.name, role: "admin" });
    res.json({ url: `${mdm.url.replace(/\/$/, "")}/#sso=${token}` });
  });

  return router;
}
