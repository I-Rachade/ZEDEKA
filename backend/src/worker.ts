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
import { runPlannedMeals } from "./plannedMeals.js";
import { remindLeases } from "./lease.js";
import { chargeStorage } from "./logistics.js";
import { runSchoolTrips } from "./school.js";
import { purgeExpiredData } from "./retention.js";
import { createMetrics } from "./apiMetrics.js";
import { checkPerfAlerts } from "./perfReport.js";
import { createErrorLog } from "./errorLog.js";
import { sampleOnline, type OnlineCounter } from "./techSamples.js";
import { retryTransient } from "./retryTransient.js";
import { alertAnomalies, detectAnomalies, probeApi, sampleActivity } from "./techInsights.js";
import { alertAudit, runAudit, type AuditConfig } from "./securityAudit.js";
import { advanceAllRides } from "./zed.js";
import { r2Store } from "./storage.js";
import { Osrm, osrmPrimary } from "./osrm.js";
import { Live } from "./liveHub.js";
import { channelOf, readLiveTicket, withLive, type LivePublisher } from "./live.js";
import { DEFAULT_ROUTING_URL, withFallback } from "./routing.js";
import { isMapPath, serveMap, syncMap } from "./mapTiles.js";

// Classe du serveur d'itinéraires (Cloudflare Containers), déclarée dans wrangler.jsonc.
export { Osrm };
// Temps réel des écrans (WebSocket), déclaré dans wrangler.jsonc.
export { Live };

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
  LIVE?: DurableObjectNamespace<Live>;
  // Autre serveur compatible OSRM, prioritaire sur le nôtre s'il est défini (ex. pour un essai).
  ROUTING_URL?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_ACCESS_REQUIRED?: string;
  ADMIN_EMAILS?: string;
  // Parc mobile (MDM) : adresse de la console (Worker zedeka-mdm) et secret partagé, posé par le workflow « Déployer le parc mobile ».
  MDM_URL?: string;
  MDM_SSO_SECRET?: string;
  // Limites par adresse IP (wrangler.jsonc, « ratelimits »).
  LOGIN_LIMITER?: RateLimit;
  OTP_LIMITER?: RateLimit;
  LOOKUP_LIMITER?: RateLimit;
  FORMS_LIMITER?: RateLimit;
  APPLY_LIMITER?: RateLimit;
  IP_BURST_LIMITER?: RateLimit;
  // Dépôt GitHub dont la branche « bilan » porte le rapport du workflow « Bilan quotidien » (défaut : I-Rachade/ZEDEKA).
  GITHUB_REPO?: string;
};

const config = env as unknown as Env;
// Signal « commande changée » vers les écrans ouverts (src/live.ts), envoyé en arrière-plan.
const publish: LivePublisher = (channels) => {
  if (!config.LIVE || !channels.length) return;
  waitUntil(config.LIVE.getByName("hub").publish(channels).catch((e) => console.error("temps réel", e)));
};
const prisma = withLive(createPrisma(config.DB), publish, (p) => waitUntil(p));
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
  // Une notification réveille aussi les écrans ouverts du destinataire, même sans abonnement aux notifications.
  push: (role, subject, payload) => {
    const channel = channelOf(role, subject);
    if (channel) publish([channel]);
    return keepAlive(baseNotifier.push(role, subject, payload));
  },
  staff: (category, payload) => {
    publish(["admin"]);
    return keepAlive(baseNotifier.staff(category, payload));
  },
  sms: (phone, text) => keepAlive(baseNotifier.sms(phone, text)),
};

const files = r2Store(config.MEDIA);
// Performance de l'API (page « Performance » de l'admin) : compteurs en mémoire, ajoutés dans D1 en arrière-plan.
const metrics = createMetrics(prisma, { background: (p) => waitUntil(p) });
// Journal des erreurs de l'écran technique : chaque nouvelle erreur réveille l'écran (canal « tech »).
const errorLog = createErrorLog(prisma, { background: (p) => waitUntil(p), onWritten: () => publish(["tech"]) });
// Utilisateurs en ligne : connexions « presence:<appli> » ouvertes dans le Durable Object Live.
const online: OnlineCounter | undefined = config.LIVE ? () => config.LIVE!.getByName("hub").counts() : undefined;
// Erreur d'une tâche du cron : journal de la console et journal des erreurs de l'écran technique.
const cronFailed = (task: string) => (e: unknown) => {
  console.error(task, e);
  errorLog.record({ source: "cron", route: task, status: 0, message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) });
};

// Battement du cron (une fois par minute) : la base répond-elle, et en combien de temps. Sert à la disponibilité.
async function heartbeat() {
  const t0 = Date.now();
  const ok = await prisma.$queryRawUnsafe("SELECT 1").then(
    () => true,
    () => false,
  );
  await metrics.heartbeat(ok, Date.now() - t0);
  await Promise.all([metrics.flush(), errorLog.flush()]);
}

// Bilan quotidien de sécurité et d'état (src/securityAudit.ts) : à 6 h (heure de Lomé, UTC) et depuis l'admin.
const audit: AuditConfig = {
  origin: config.FRONTEND_ORIGIN ?? "https://zedeka.poinderecharge.com",
  ciReportUrl: `https://raw.githubusercontent.com/${config.GITHUB_REPO ?? "I-Rachade/ZEDEKA"}/bilan/bilan.json`,
  limiters: {
    connexion: Boolean(config.LOGIN_LIMITER),
    "codes SMS": Boolean(config.OTP_LIMITER),
    recherches: Boolean(config.LOOKUP_LIMITER),
    formulaires: Boolean(config.FORMS_LIMITER),
    candidatures: Boolean(config.APPLY_LIMITER),
    rafales: Boolean(config.IP_BURST_LIMITER),
  },
};
// Toutes les 5 minutes : tests de santé de l'API, relevés d'activité, puis anomalies (alerte si grave).
async function healthRound(at: number) {
  await Promise.all([probeApi(prisma, { origin: audit.origin, errorLog }, at), sampleActivity(prisma, at)]);
  const anomalies = await detectAnomalies(prisma, new Date(at));
  if (anomalies.length) publish(["tech"]);
  await alertAnomalies(prisma, notifier, anomalies, new Date(at));
}

// 7 h : si le rapport du dépôt manquait au bilan de 6 h (workflow GitHub en retard), on refait le bilan du jour.
async function retryAuditWithoutReport() {
  const today = await prisma.securityAudit.findUnique({ where: { day: new Date().toISOString().slice(0, 10) }, select: { ci: true } });
  if (!today || today.ci) return;
  await dailyAudit();
}

async function dailyAudit() {
  const result = await runAudit(prisma, audit);
  await alertAudit(prisma, notifier, result);
}

const PORT = 8080;
createApp(prisma, {
  metrics,
  errorLog,
  online,
  audit,
  notifier,
  frontendOrigin: config.FRONTEND_ORIGIN ?? "https://zedeka.poinderecharge.com",
  zedekaWhatsapp: config.ZEDEKA_WHATSAPP ?? "",
  adminPassword: config.ADMIN_PASSWORD ?? "",
  adminSecret: config.ADMIN_SECRET ?? "",
  files,
  access: adminAccess(config),
  mdm: { url: config.MDM_URL ?? "https://zedeka-mdm.poinderecharge.com", ssoSecret: config.MDM_SSO_SECRET ?? "" },
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

// Connexion temps réel d'un écran : ticket signé obtenu juste avant par une route de l'API (src/live.ts).
function connectLive(request: Request, url: URL): Promise<Response> | Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket attendu", { status: 426 });
  if (!config.LIVE) return new Response("Temps réel indisponible", { status: 503 });
  const channels = readLiveTicket(url.searchParams.get("t") ?? "", config.ADMIN_SECRET ?? "");
  if (!channels) return new Response("Ticket invalide", { status: 401 });
  const headers = new Headers({ Upgrade: "websocket", "x-live-channels": channels.join(",") });
  return config.LIVE.getByName("hub").fetch("http://live/", { headers });
}

export default {
  // Tuiles du fond de carte lues directement dans R2 (lectures par plages d'octets), sans passer par Express.
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if ((request.method === "GET" || request.method === "HEAD") && isMapPath(url.pathname)) return serveMap(request, config.MEDIA);
    if (url.pathname === "/api/live") return connectLive(request, url);
    return http.fetch!(request, env, ctx);
  },
  // Chaque minute (wrangler.jsonc) : relances des restaurants, propositions expirées, attribution automatique, livreurs inactifs,
  // liens de position échus, positions de destinataires à effacer et livraisons sans réponse du client ; une fois
  // par heure, les données dont la durée de conservation est écoulée (src/retention.ts).
  async scheduled(controller: ScheduledController) {
    const minute = new Date(controller.scheduledTime).getUTCMinutes();
    await Promise.allSettled([
      // Battement (disponibilité) puis, toutes les 5 minutes, alertes de performance à l'équipe (catégorie TECH).
      heartbeat()
        .catch(cronFailed("battement"))
        .then(() => (minute % 5 === 3 ? checkPerfAlerts(prisma, notifier) : null))
        .catch(cronFailed("alertes de performance")),
      // Toutes les 5 minutes : utilisateurs en ligne par appli (écran technique).
      minute % 5 === 4 ? retryTransient(() => sampleOnline(prisma, online, controller.scheduledTime)).catch(cronFailed("utilisateurs en ligne")) : null,
      minute % 5 === 1 ? healthRound(controller.scheduledTime).catch(cronFailed("santé de l'API")) : null,
      // Chaque jour à 6 h (heure de Lomé, UTC) : bilan de sécurité et d'état.
      new Date(controller.scheduledTime).getUTCHours() === 6 && minute === 0 ? dailyAudit().catch(cronFailed("bilan quotidien")) : null,
      new Date(controller.scheduledTime).getUTCHours() === 7 && minute === 0 ? retryAuditWithoutReport().catch(cronFailed("bilan quotidien")) : null,
      escalateUnanswered(prisma, notifier).catch(cronFailed("alertes")),
      remindTableCalls(prisma, notifier).catch(cronFailed("sonnerie de table")),
      // Propositions expirées d'abord, puis attribution automatique (si activée) des courses revenues.
      // Retraits réservés (rappel 45 min avant, début ou retrait 30 min avant) avant l'attribution, pour qu'une course
      // retirée reparte dans la même minute.
      expireAssignments(prisma, notifier)
        .catch(cronFailed("affectations"))
        .then(() => runScheduledPickups(prisma, notifier))
        .catch(cronFailed("créneaux"))
        // Livreurs favoris des restaurants et marchands d'abord (même si l'attribution automatique est coupée).
        .then(() => favoriteDispatch(prisma, notifier))
        .catch(cronFailed("livreurs favoris"))
        .then(() => autoDispatch(prisma, notifier))
        .catch(cronFailed("attribution automatique")),
      retryTransient(() => autoOffline(prisma)).catch(cronFailed("hors ligne")),
      // Repas planifiés et formule cantine : commandes créées 60 min avant l'heure (src/plannedMeals.ts).
      runPlannedMeals(prisma, notifier).catch(cronFailed("repas planifiés")),
      advanceAllRides(prisma, notifier).catch(cronFailed("zed")),
      retryTransient(() => sweepLocationRequests(prisma)).catch(cronFailed("positions")),
      autoCloseDeliveries(prisma, notifier).catch(cronFailed("clôtures")),
      // Une fois par heure : rappels d'expiration des pièces d'identité des livreurs.
      new Date(controller.scheduledTime).getUTCMinutes() === 5 ? notifyExpiringIds(prisma, notifier).catch(cronFailed("pièces d'identité")) : null,
      // Une fois par heure : leasing de motos (rappels aux livreurs à partir de 7 h, retards signalés à l'équipe).
      // Toutes les 5 minutes : trajets scolaires du jour créés, et trajet pas commencé signalé à l'équipe.
      new Date(controller.scheduledTime).getUTCMinutes() % 5 === 2 ? runSchoolTrips(prisma, notifier).catch(cronFailed("transport scolaire")) : null,
      new Date(controller.scheduledTime).getUTCMinutes() === 10 ? remindLeases(prisma, notifier).catch(cronFailed("leasing")) : null,
      // Le 1er du mois, une fois par heure (sans double facture) : frais de stockage du mois écoulé à l'entrepôt.
      new Date(controller.scheduledTime).getUTCMinutes() === 20 ? chargeStorage(prisma, new Date(controller.scheduledTime)).catch(cronFailed("stockage")) : null,
      new Date(controller.scheduledTime).getUTCMinutes() === 0 ? purgeExpiredData(prisma, files).catch(cronFailed("conservation")) : null,
      // Fond de carte : nouvelle version publiée par le workflow « Carte du Togo » recopiée dans R2.
      new Date(controller.scheduledTime).getUTCMinutes() === 30
        ? syncMap(config.MEDIA).then((r) => r === "copiée" && console.log("carte du Togo copiée dans R2")).catch(cronFailed("carte"))
        : null,
    ]);
  },
} satisfies ExportedHandler;
