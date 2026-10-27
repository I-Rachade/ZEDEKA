import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { PrismaClient } from "@prisma/client";
import webpush from "web-push";

// Notifications vers les partenaires et l'admin : Web Push sur les navigateurs abonnés, SMS si un fournisseur
// est branché (sinon le message est seulement journalisé).

export type PushPayload = { title: string; body: string; url: string; tag?: string; alarm?: boolean };
export type SmsSender = (phone: string, text: string) => Promise<void>;

export type Notifier = {
  publicKey: string;
  push: (role: string, subject: string, payload: PushPayload) => Promise<number>;
  sms: (phone: string, text: string) => Promise<void>;
};

type Keys = { publicKey: string; privateKey: string };

// Clés VAPID : variables d'environnement en production ; en développement, générées une fois et gardées sur disque.
function vapidKeys(file: string): Keys {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as Keys;
  const keys = webpush.generateVAPIDKeys();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(keys));
  return keys;
}

export function createNotifier(prisma: PrismaClient, opts: { keysFile: string; contact?: string; sendSms?: SmsSender; silent?: boolean }): Notifier {
  const keys = vapidKeys(opts.keysFile);
  webpush.setVapidDetails(opts.contact ?? "mailto:contact@zedeka.tg", keys.publicKey, keys.privateKey);

  return {
    publicKey: keys.publicKey,
    async push(role, subject, payload) {
      const subs = await prisma.pushSubscription.findMany({ where: { role, subject } });
      let sent = 0;
      await Promise.all(
        subs.map(async (s) => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 600, urgency: "high" });
            sent++;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            // Abonnement expiré ou retiré par le navigateur.
            if (status === 404 || status === 410) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
            else if (!opts.silent) console.error("push", status ?? e);
          }
        }),
      );
      return sent;
    },
    async sms(phone, text) {
      if (opts.sendSms) await opts.sendSms(phone, text);
      else if (!opts.silent) console.log(`[SMS non envoyé, aucun fournisseur] ${phone} : ${text}`);
    },
  };
}

// Pour les tests : ne fait rien.
export const silentNotifier: Notifier = { publicKey: "", push: async () => 0, sms: async () => {} };
