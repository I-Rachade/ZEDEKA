import { createHmac } from "node:crypto";
import { Router, text } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { issueLiveTicket, PRESENCE_APPS, type PresenceApp } from "../live.js";
import type { ErrorLog } from "../errorLog.js";

// Signaux envoyés par les applis pour l'écran technique, sans compte ni adresse IP :
// - GET /api/presence : ticket temps réel « presence:<appli> » (un onglet ouvert = un utilisateur en ligne) ; l'appareil
//   est compté une fois par jour dans les actifs du jour, par une empreinte à sens unique de son identifiant local ;
// - POST /api/client-errors : plantages d'écran (erreur JavaScript), regroupés dans le journal des erreurs.

const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;
// Garde en mémoire : un appareil déjà compté aujourd'hui par cette instance n'est pas réécrit.
const MAX_SEEN = 50_000;

export const dayOf = (at: Date) => at.toISOString().slice(0, 10);
export const deviceHash = (secret: string, device: string) => createHmac("sha256", `zedeka-device:${secret}`).update(device).digest("base64url").slice(0, 22);

const crash = z
  .array(
    z.object({
      app: z.enum(PRESENCE_APPS),
      page: z.string().trim().min(1).max(80).regex(/^\/[A-Za-z0-9/_[\]-]*$/),
      message: z.string().max(500),
    }),
  )
  .min(1)
  .max(5);

export function techSignalsRouter(prisma: PrismaClient, config: { secret: string; errorLog?: ErrorLog; now?: () => Date }) {
  const router = Router();
  const now = config.now ?? (() => new Date());
  let seenDay = "";
  let seen = new Set<string>();

  router.get("/presence", async (req, res) => {
    const app = String(req.query.app ?? "");
    if (!(PRESENCE_APPS as readonly string[]).includes(app)) {
      res.status(400).json({ error: "Appli inconnue" });
      return;
    }
    const device = String(req.query.d ?? "");
    if (DEVICE.test(device)) {
      const day = dayOf(now());
      if (day !== seenDay || seen.size >= MAX_SEEN) {
        seenDay = day;
        seen = new Set();
      }
      const hash = deviceHash(config.secret, device);
      const key = `${app}|${hash}`;
      if (!seen.has(key)) {
        seen.add(key);
        await prisma
          .$executeRawUnsafe(`INSERT OR IGNORE INTO "ActiveDay" ("day", "app", "device") VALUES (?, ?, ?)`, day, app, hash)
          .catch((e) => console.error("actifs du jour", e));
      }
    }
    res.set("Cache-Control", "no-store");
    res.json({ ticket: issueLiveTicket(config.secret, [`presence:${app as PresenceApp}`]) });
  });

  // sendBeacon envoie du texte : le corps JSON est lu à la main.
  router.post("/client-errors", text({ type: "*/*", limit: "8kb" }), (req, res) => {
    let raw: unknown = req.body;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch {
        raw = null;
      }
    }
    const parsed = crash.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ error: "Erreurs invalides" });
      return;
    }
    for (const e of parsed.data) config.errorLog?.record({ source: e.app, route: e.page, status: 0, message: e.message });
    res.status(204).end();
  });

  return router;
}
