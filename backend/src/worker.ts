import { env } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { adminAccess } from "./access.js";
import { escalateUnanswered } from "./alerts.js";
import { createApp } from "./app.js";
import { createPrisma } from "./db.js";
import { createNotifier } from "./notify.js";
import { diditVerifier } from "./otp.js";
import { autoOffline, expireAssignments } from "./routes/driverApp.js";
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
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_CONTACT?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_ACCESS_REQUIRED?: string;
  ADMIN_EMAILS?: string;
};

const config = env as unknown as Env;
const prisma = createPrisma(config.DB);
const vapid =
  config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
    ? { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, contact: config.VAPID_CONTACT ?? "mailto:contact@zedeka.tg" }
    : null;
const notifier = createNotifier(prisma, { vapid });

const PORT = 8080;
createApp(prisma, {
  notifier,
  frontendOrigin: config.FRONTEND_ORIGIN ?? "https://zedeka.poinderecharge.com",
  zedekaWhatsapp: config.ZEDEKA_WHATSAPP ?? "",
  adminPassword: config.ADMIN_PASSWORD ?? "",
  adminSecret: config.ADMIN_SECRET ?? "",
  files: r2Store(config.MEDIA),
  access: adminAccess(config),
  // Codes de connexion par SMS via Didit (secret DIDIT_API_KEY, comme poinderecharge).
  phoneVerifier: config.DIDIT_API_KEY ? diditVerifier(config.DIDIT_API_KEY) : undefined,
  // Codes affichés à l'écran tant qu'aucun fournisseur SMS n'est branché : seulement si OTP_DEV_CODES=true.
  otpDevCodes: config.OTP_DEV_CODES === "true",
}).listen(PORT);

export default {
  ...httpServerHandler({ port: PORT }),
  // Chaque minute (wrangler.jsonc) : relances des restaurants, propositions expirées, livreurs inactifs.
  async scheduled() {
    await Promise.allSettled([
      escalateUnanswered(prisma, notifier).catch((e) => console.error("alertes", e)),
      expireAssignments(prisma, notifier).catch((e) => console.error("affectations", e)),
      autoOffline(prisma).catch((e) => console.error("hors ligne", e)),
    ]);
  },
} satisfies ExportedHandler;
