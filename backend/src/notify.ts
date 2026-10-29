import type { PrismaClient } from "@prisma/client";
import type { FcmSender } from "./fcm.js";
import { sendWebPush, type VapidKeys } from "./webPush.js";

// Notifications vers les partenaires et l'admin : Web Push sur les navigateurs abonnés, Firebase (FCM) sur les
// applications Android et iOS, SMS si un fournisseur est branché (sinon le message est seulement journalisé).

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

// Les applications Android et iOS s'abonnent avec leur jeton Firebase, enregistré avec ce préfixe à la place de l'adresse.
export const NATIVE_PREFIX = "fcm:";

// Clés VAPID dans les secrets du Worker (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY), compte de service Firebase dans FCM_SERVICE_ACCOUNT.
export function createNotifier(prisma: PrismaClient, opts: { vapid: VapidKeys | null; fcm?: FcmSender | null; sendSms?: SmsSender; silent?: boolean }): Notifier {
  const keys = opts.vapid;
  const fcm = opts.fcm ?? null;

  function send(s: { endpoint: string; p256dh: string; auth: string }) {
    if (s.endpoint.startsWith(NATIVE_PREFIX)) return (payload: PushPayload) => fcm!(s.endpoint.slice(NATIVE_PREFIX.length), payload);
    return (payload: PushPayload) => sendWebPush(keys!, { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
  }

  return {
    publicKey: keys?.publicKey ?? "",
    async push(role, subject, payload) {
      if (!keys && !fcm) return 0;
      // Les anciens abonnements vers une autre adresse sont ignorés, comme ceux dont le service n'est pas configuré.
      const subs = (await prisma.pushSubscription.findMany({ where: { role, subject } })).filter((s) =>
        s.endpoint.startsWith(NATIVE_PREFIX) ? Boolean(fcm) : Boolean(keys) && isPushService(s.endpoint),
      );
      let sent = 0;
      await Promise.all(
        subs.map(async (s) => {
          const result = await send(s)(payload).catch((e) => {
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
