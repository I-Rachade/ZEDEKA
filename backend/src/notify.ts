import type { PrismaClient } from "@prisma/client";
import { sendWebPush, type VapidKeys } from "./webPush.js";

// Notifications vers les partenaires et l'admin : Web Push sur les navigateurs abonnés, SMS si un fournisseur
// est branché (sinon le message est seulement journalisé).

export type PushPayload = { title: string; body: string; url: string; tag?: string; alarm?: boolean };
export type SmsSender = (phone: string, text: string) => Promise<void>;

export type Notifier = {
  publicKey: string;
  push: (role: string, subject: string, payload: PushPayload) => Promise<number>;
  sms: (phone: string, text: string) => Promise<void>;
};

// Clés VAPID dans les secrets du Worker (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
export function createNotifier(prisma: PrismaClient, opts: { vapid: VapidKeys | null; sendSms?: SmsSender; silent?: boolean }): Notifier {
  const keys = opts.vapid;

  return {
    publicKey: keys?.publicKey ?? "",
    async push(role, subject, payload) {
      if (!keys) return 0;
      const subs = await prisma.pushSubscription.findMany({ where: { role, subject } });
      let sent = 0;
      await Promise.all(
        subs.map(async (s) => {
          const result = await sendWebPush(keys, { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload)).catch((e) => {
            if (!opts.silent) console.error("push", e);
            return "failed" as const;
          });
          if (result === "sent") sent++;
          // Abonnement expiré ou retiré par le navigateur.
          else if (result === "gone") await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
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
