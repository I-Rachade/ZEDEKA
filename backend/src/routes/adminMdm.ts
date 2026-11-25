import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Staff } from "../team.js";
import type { Notifier } from "../notify.js";

// Parc mobile (MDM) : console de gestion des téléphones et tablettes de l'équipe (dossier mdm/ du dépôt,
// Worker zedeka-mdm). Le back-office ouvre la console sans second mot de passe : il signe un jeton d'une minute,
// à usage unique, avec le secret MDM_SSO_SECRET partagé entre les deux Workers.
// fetcher : liaison de service vers zedeka-mdm en production (sinon fetch vers l'adresse publique).
export type MdmConfig = { url: string; ssoSecret: string; fetcher?: (url: string, init: RequestInit) => Promise<Response> };

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function signMdmToken(secret: string, claims: Record<string, unknown>, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: "zedeka", aud: "mdm", iat, exp: iat + 60, jti: randomUUID(), ...claims }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

// Jeton signé par la console MDM (alertes graves) : HS256, même secret, une minute au plus.
export function verifyMdmToken(secret: string, token: string, aud: string, now = Date.now()): Record<string, any> | null {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!head || !body || !sig || secret.length < 32) return null;
  const expected = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    const t = Math.floor(now / 1000);
    if (claims.aud !== aud || typeof claims.exp !== "number" || claims.exp < t || claims.exp - t > 120) return null;
    return claims;
  } catch {
    return null;
  }
}

// Alertes graves du parc mobile (perte, vol, protection désactivée, hors zone, départ d'un membre) : la console MDM
// les envoie ici, et elles partent en notification au directeur et à l'adjoint (catégorie « Technique »).
export function mdmHooksRouter(notifier: Notifier, mdm: MdmConfig | undefined) {
  const router = Router();
  router.post("/mdm/alerts", async (req, res) => {
    const claims = mdm?.ssoSecret ? verifyMdmToken(mdm.ssoSecret, req.body?.token, "zedeka") : null;
    if (!claims || claims.iss !== "zedeka-mdm" || typeof claims.message !== "string") {
      res.status(401).json({ error: "Jeton invalide" });
      return;
    }
    const critical = claims.severity === "critique";
    await notifier.staff("TECH", {
      title: critical ? "Parc mobile : alerte critique" : "Parc mobile : alerte",
      body: claims.message.slice(0, 300),
      url: "/admin/mdm",
      tag: `mdm-${Number(claims.alert_id) || 0}`,
      alarm: critical,
    });
    res.status(204).end();
  });
  return router;
}

// Un membre quitte l'équipe (désactivé ou supprimé) : la console MDM désactive son compte et verrouille ses téléphones
// d'entreprise. Un échec est journalisé mais ne bloque jamais l'action dans l'admin.
export async function notifyMemberLeft(mdm: MdmConfig | undefined, member: { email: string | null; name: string }) {
  if (!mdm?.url || !mdm.ssoSecret || mdm.ssoSecret.length < 32 || !member.email) return false;
  const token = signMdmToken(mdm.ssoSecret, { aud: "mdm-events", event: "member_left", email: member.email.toLowerCase(), name: member.name });
  try {
    const res = await (mdm.fetcher ?? fetch)(`${mdm.url.replace(/\/$/, "")}/api/integration/zedeka/member-left`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error("parc mobile : départ non transmis", res.status);
    return res.ok;
  } catch (e) {
    console.error("parc mobile : départ non transmis", e);
    return false;
  }
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
