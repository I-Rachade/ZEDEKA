import { notifyExpiringIds } from "./idExpiry.js";
import { env, waitUntil } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import { adminAccess } from "./access.js";
import { escalateUnanswered } from "./alerts.js";
import { remindTableCalls } from "./tableCalls.js";
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
import { favoriteDispatch } from "./favorites.js";
import { runScheduledPickups } from "./scheduledPickup.js";
import { purgeExpiredData } from "./retention.js";
import { advanceAllRides } from "./zed.js";
import { r2Store } from "./storage.js";
import { Osrm, osrmPrimary } from "./osrm.js";
import { DEFAULT_ROUTING_URL, withFallback } from "./routing.js";
import { isMapPath, serveMap, syncMap } from "./mapTiles.js";

// Classe du serveur d'itinéraires (Cloudflare Containers), déclarée dans wrangler.jsonc.
export { Osrm };

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
  // Serveur d'itinéraires de Zedeka (OSRM du Togo dans Cloudflare Containers, src/osrm.ts).
  OSRM?: DurableObjectNamespace<Osrm>;
  // Autre serveur compatible OSRM, prioritaire sur le nôtre s'il est défini (ex. pour un essai).
  ROUTING_URL?: string;
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
  IP_BURST_LIMITER?: RateLimit;
};

const config = env as unknown as Env;
const prisma = createPrisma(config.DB);
const vapid =
  config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY
    ? { publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY, contact: config.VAPID_CONTACT ?? "mailto:contact@zedeka.tg" }
    : null;
const fcmAccount = parseServiceAccount(config.FCM_SERVICE_ACCOUNT);
const baseNotifier = createNotifier(prisma, { vapid, fcm: fcmAccount ? createFcmSender(fcmAccount) : null });
// Les notifications partent souvent sans être attendues (`void notifier.push(...)`) pour ne pas retarder la réponse.
// Sur Workers, un travail non attendu peut être coupé dès la réponse envoyée : waitUntil le garde en vie jusqu'au bout,
// sinon le client ne reçoit l'étape (commande acceptée, livreur en route, livrée) qu'à son prochain rechargement.
const keepAlive = <T>(p: Promise<T>): Promise<T> => {
  waitUntil(p.catch(() => {}));
  return p;
};
const notifier: typeof baseNotifier = {
  ...baseNotifier,
  push: (role, subject, payload) => keepAlive(baseNotifier.push(role, subject, payload)),
  staff: (category, payload) => keepAlive(baseNotifier.staff(category, payload)),
  sms: (phone, text) => keepAlive(baseNotifier.sms(phone, text)),
};

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
  // Accueil et carte des restaurants gardés 20 s en mémoire (vidé à chaque modification reçue par cette instance).
  catalogCacheMs: 20_000,
  // Itinéraires : ROUTING_URL s'il est défini, sinon notre serveur OSRM (secours : serveur public de démonstration).
  ...(config.ROUTING_URL
    ? { routingUrl: config.ROUTING_URL }
    : config.OSRM
      ? { routingUrl: "http://osrm", routeFetcher: withFallback(osrmPrimary(config.OSRM), DEFAULT_ROUTING_URL), routeTimeoutMs: 40_000 }
      : {}),
  emailSender: config.EMAIL && config.EMAIL_FROM ? cloudflareSender(config.EMAIL, config.EMAIL_FROM, config.FRONTEND_ORIGIN) : undefined,
  limiters: {
    login: config.LOGIN_LIMITER,
    otp: config.OTP_LIMITER,
    lookup: config.LOOKUP_LIMITER,
    forms: config.FORMS_LIMITER,
    applications: config.APPLY_LIMITER,
    ipBurst: config.IP_BURST_LIMITER,
  },
}).listen(PORT);

const http = httpServerHandler({ port: PORT });

export default {
  // Tuiles du fond de carte lues directement dans R2 (lectures par plages d'octets), sans passer par Express.
  fetch(request, env, ctx) {
    if ((request.method === "GET" || request.method === "HEAD") && isMapPath(new URL(request.url).pathname)) return serveMap(request, config.MEDIA);
    return http.fetch!(request, env, ctx);
  },
  // Chaque minute (wrangler.jsonc) : relances des restaurants, propositions expirées, attribution automatique, livreurs inactifs,
  // liens de position échus, positions de destinataires à effacer et livraisons sans réponse du client ; une fois
  // par heure, les données dont la durée de conservation est écoulée (src/retention.ts).
  async scheduled(controller: ScheduledController) {
    await Promise.allSettled([
      escalateUnanswered(prisma, notifier).catch((e) => console.error("alertes", e)),
      remindTableCalls(prisma, notifier).catch((e) => console.error("sonnerie de table", e)),
      // Propositions expirées d'abord, puis attribution automatique (si activée) des courses revenues.
      // Retraits réservés (rappel 45 min avant, début ou retrait 30 min avant) avant l'attribution, pour qu'une course
      // retirée reparte dans la même minute.
      expireAssignments(prisma, notifier)
        .catch((e) => console.error("affectations", e))
        .then(() => runScheduledPickups(prisma, notifier))
        .catch((e) => console.error("créneaux", e))
        // Livreurs favoris des restaurants et marchands d'abord (même si l'attribution automatique est coupée).
        .then(() => favoriteDispatch(prisma, notifier))
        .catch((e) => console.error("livreurs favoris", e))
        .then(() => autoDispatch(prisma, notifier))
        .catch((e) => console.error("attribution automatique", e)),
      autoOffline(prisma).catch((e) => console.error("hors ligne", e)),
      advanceAllRides(prisma, notifier).catch((e) => console.error("zed", e)),
      sweepLocationRequests(prisma).catch((e) => console.error("positions", e)),
      autoCloseDeliveries(prisma, notifier).catch((e) => console.error("clôtures", e)),
      // Une fois par heure : rappels d'expiration des pièces d'identité des livreurs.
      new Date(controller.scheduledTime).getUTCMinutes() === 5 ? notifyExpiringIds(prisma, notifier).catch((e) => console.error("pièces d'identité", e)) : null,
      new Date(controller.scheduledTime).getUTCMinutes() === 0 ? purgeExpiredData(prisma, files).catch((e) => console.error("conservation", e)) : null,
      // Fond de carte : nouvelle version publiée par le workflow « Carte du Togo » recopiée dans R2.
      new Date(controller.scheduledTime).getUTCMinutes() === 30
        ? syncMap(config.MEDIA).then((r) => r === "copiée" && console.log("carte du Togo copiée dans R2")).catch((e) => console.error("carte", e))
        : null,
    ]);
  },
} satisfies ExportedHandler;
