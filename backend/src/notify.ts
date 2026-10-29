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

// Le serveur envoie une requête à l'adresse de l'abonnement : on n'accepte que les services push des navigateurs,
// sinon un compte pourrait faire appeler par l'API une adresse de son choix (SSRF).
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /\.push\.apple\.com$/];

export function isPushService(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((h) => h.test(url.hostname));
  } catch {
    return false;
  }
}

// Clés VAPID dans les secrets du Worker (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY).
export function createNotifier(prisma: PrismaClient, opts: { vapid: VapidKeys | null; sendSms?: SmsSender; silent?: boolean }): Notifier {
  const keys = opts.vapid;

  return {
    publicKey: keys?.publicKey ?? "",
    async push(role, subject, payload) {
      if (!keys) return 0;
      // Les anciens abonnements vers une autre adresse sont ignorés.
      const subs = (await prisma.pushSubscription.findMany({ where: { role, subject } })).filter((s) => isPushService(s.endpoint));
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
