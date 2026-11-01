import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { adminAccess } from "./access.js";
import { escalateUnanswered } from "./alerts.js";
import { createApp } from "./app.js";
import { createPrisma } from "./db.js";
import { sweepLocationRequests } from "./locationRequest.js";
import { createFcmSender, parseServiceAccount } from "./fcm.js";
import { createNotifier } from "./notify.js";
import { cloudflareSender, type SendEmailBinding } from "./email.js";
import { diditVerifier } from "./otp.js";
import { autoOffline, expireAssignments } from "./routes/driverApp.js";
import { autoCloseDeliveries } from "./receipt.js";
import { autoDispatch } from "./autoDispatch.js";
import { purgeExpiredData } from "./retention.js";
import { r2Store } from "./storage.js";

// API Zedeka sur Cloudflare Workers : l'application Express tourne telle quelle grâce à nodejs_compat.
// Pas d'adresse publique : le site (zedeka.poinderecharge.com) lui passe /api/* par une liaison de service.

export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  FRONTEND_ORIGIN?: string;
  ZEDEKA_WHATSAPP?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SECRET?: string;
  OTP_DEV_CODES?: string;
  DIDIT_API_KEY?: string;
  // E-mails des codes « PIN oublié » (Cloudflare Email Service) et adresse d'expédition, ex. « Zedeka <noreply@zedeka.poinderecharge.com> ».
  EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_CONTACT?: string;
  // JSON du compte de service Firebase : notifications des applications Android et iOS.
  FCM_SERVICE_ACCOUNT?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_ACCESS_REQUIRED?: string;
  ADMIN_EMAILS?: string;
  // Limites par adresse IP (wrangler.jsonc, « ratelimits »).
  LOGIN_LIMITER?: RateLimit;
  OTP_LIMITER?: RateLimit;
  LOOKUP_LIMITER?: RateLimit;
  FORMS_LIMITER?: RateLimit;
  APPLY_LIMITER?: RateLimit;
};

const config = env as unknown as Env;
const prisma = createPrisma(config.DB);
const vapid =
  config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
    ? { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, contact: config.VAPID_CONTACT ?? "mailto:contact@zedeka.tg" }
    : null;
const fcmAccount = parseServiceAccount(config.FCM_SERVICE_ACCOUNT);
const notifier = createNotifier(prisma, { vapid, fcm: fcmAccount ? createFcmSender(fcmAccount) : null });

const files = r2Store(config.MEDIA);

const PORT = 8080;
createApp(prisma, {
  notifier,
  frontendOrigin: config.FRONTEND_ORIGIN ?? "https://zedeka.poinderecharge.com",
  zedekaWhatsapp: config.ZEDEKA_WHATSAPP ?? "",
  adminPassword: config.ADMIN_PASSWORD ?? "",
  adminSecret: config.ADMIN_SECRET ?? "",
  files,
  access: adminAccess(config),
  // Codes de connexion par SMS via Didit (secret DIDIT_API_KEY, comme poinderecharge).
  phoneVerifier: config.DIDIT_API_KEY ? diditVerifier(config.DIDIT_API_KEY) : undefined,
  // Codes affichés à l'écran tant qu'aucun fournisseur SMS n'est branché : seulement si OTP_DEV_CODES=true.
  otpDevCodes: config.OTP_DEV_CODES === "true",
  emailSender: config.EMAIL && config.EMAIL_FROM ? cloudflareSender(config.EMAIL, config.EMAIL_FROM, config.FRONTEND_ORIGIN) : undefined,
  limiters: {
    login: config.LOGIN_LIMITER,
    otp: config.OTP_LIMITER,
    lookup: config.LOOKUP_LIMITER,
    forms: config.FORMS_LIMITER,
    applications: config.APPLY_LIMITER,
  },
}).listen(PORT);

export default {
  ...httpServerHandler({ port: PORT }),
  // Chaque minute (wrangler.jsonc) : relances des restaurants, propositions expirées, attribution automatique, livreurs inactifs,
  // liens de position échus, positions de destinataires à effacer et livraisons sans réponse du client ; une fois
  // par heure, les données dont la durée de conservation est écoulée (src/retention.ts).
  async scheduled(controller: ScheduledController) {
    await Promise.allSettled([
      escalateUnanswered(prisma, notifier).catch((e) => console.error("alertes", e)),
      // Propositions expirées d'abord, puis attribution automatique (si activée) des courses revenues.
      expireAssignments(prisma, notifier)
        .catch((e) => console.error("affectations", e))
        .then(() => autoDispatch(prisma, notifier))
        .catch((e) => console.error("attribution automatique", e)),
      autoOffline(prisma).catch((e) => console.error("hors ligne", e)),
      sweepLocationRequests(prisma).catch((e) => console.error("positions", e)),
      autoCloseDeliveries(prisma, notifier).catch((e) => console.error("clôtures", e)),
      new Date(controller.scheduledTime).getUTCMinutes() === 0 ? purgeExpiredData(prisma, files).catch((e) => console.error("conservation", e)) : null,
    ]);
  },
} satisfies ExportedHandler;
