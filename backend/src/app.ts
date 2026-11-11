import { catalogCache, invalidateCatalog } from "./catalogCache.js";
import { vitalsRouter } from "./routes/vitals.js";
import { getSettings } from "./util.js";
import "./zodFr.js";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { adminRouter } from "./routes/admin.js";
import { customerRouter } from "./routes/customer.js";
import type { EmailSender } from "./email.js";
import type { PhoneVerifier } from "./otp.js";
import { publicRouter } from "./routes/public.js";
import { tableCallPublicRouter } from "./tableCalls.js";
import { positionRouter } from "./routes/position.js";
import { driverAppRouter } from "./routes/driverApp.js";
import { restaurantPanelRouter } from "./routes/restaurantPanel.js";
import { merchantAppRouter } from "./routes/merchantApp.js";
import { partnerLogoRouter } from "./routes/adminVendors.js";
import { mediaRouter } from "./routes/menuImages.js";
import { publicAdsRouter } from "./routes/ads.js";
import { silentNotifier, type Notifier } from "./notify.js";
import { memoryStore, type FileStore } from "./storage.js";
import type { AdminAccess } from "./access.js";
import { ipAndAccount, limitFor, type Limiters } from "./rateLimit.js";
import { i18nResponses } from "./i18n.js";
import { publicServices } from "./services.js";

type Config = {
  frontendOrigin: string;
  zedekaWhatsapp: string;
  adminPassword?: string;
  adminSecret?: string;
  files?: FileStore;
  access?: AdminAccess;
  // Fournisseur des codes par SMS (Didit). Sans lui, renvoyer le code dans la réponse (développement et tests uniquement).
  phoneVerifier?: PhoneVerifier;
  otpDevCodes?: boolean;
  // Envoi des codes par e-mail (PIN oublié des clients). Sans lui, PIN oublié par SMS seulement.
  emailSender?: EmailSender;
  notifier?: Notifier;
  // Limites par adresse IP (liaisons Rate Limiting du Worker). Absentes dans les tests.
  limiters?: Limiters;
  // Durée du cache en mémoire des lectures publiques (accueil, carte d'un restaurant). 0 ou absent : pas de cache.
  catalogCacheMs?: number;
};

export function createApp(prisma: PrismaClient, config: Config) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    next();
  });
  app.use(cors({ origin: config.frontendOrigin }));
  // Inscription au mode Zed : photos du dossier (réduites sur le téléphone) dans la requête.
  app.use(["/api/livreur/zed/signup", "/api/livreur/zed/apply"], express.json({ limit: "6mb" }));
  app.use(express.json({ limit: "100kb" }));
  app.use(i18nResponses);

  const limits = config.limiters ?? {};
  // Mots de passe (admin, restaurants) et codes de réinitialisation.
  // Comptées par adresse ET compte (téléphone ou e-mail) : les clients qui partagent l'adresse de leur opérateur ne se
  // bloquent plus entre eux. Le plafond large par adresse seule (ipBurst) freine qui essaie beaucoup de comptes.
  const loginRoutes = ["/api/admin/login", "/api/restaurant/login", "/api/restaurant/password", "/api/customer/pin", "/api/livreur/pin"];
  // Codes SMS des clients et des livreurs (les limites par numéro de otp.ts s'ajoutent à celle-ci).
  const otpRoutes = ["/api/customer/otp", "/api/customer/email", "/api/livreur/otp", "/api/livreur/email"];
  app.use([...loginRoutes, ...otpRoutes], limitFor(["POST"], limits.ipBurst));
  app.use(loginRoutes, limitFor(["POST"], limits.login, ipAndAccount));
  app.use(otpRoutes, limitFor(["POST"], limits.otp, ipAndAccount));
  // Suivi par code : empêche de parcourir les codes de commande.
  app.use("/api/orders", limitFor(["GET"], limits.lookup));
  app.use("/api/track", limitFor(["POST"], limits.lookup));
  app.use("/api/places", limitFor(["GET"], limits.lookup));
  // Liens de position envoyés aux destinataires de colis.
  app.use(["/api/position", "/api/location-requests"], limitFor(["GET", "POST"], limits.lookup));
  // Formulaires publics : commandes et colis. Restaurants et livreurs ne s'inscrivent plus en ligne :
  // leurs comptes sont créés dans l'admin.
  app.use(["/api/orders", "/api/parcels", "/api/maps-link"], limitFor(["POST"], limits.forms));
  // Sonnerie de table (en plus du délai de 30 s entre deux sonneries d'une même table).
  app.use("/api/tables", limitFor(["POST"], limits.forms));
  // Appli marchand : la création d'un envoi (jusqu'à 50 colis à la fois), pas le devis qui suit la saisie.
  const merchantSends = limitFor(["POST"], limits.forms);
  app.use("/api/marchand/parcels", (req, res, next) => (req.path === "/" ? merchantSends(req, res, next) : next()));

  // Le service Zed est-il ouvert aux clients (tuile de l'accueil) ?
  app.get("/api/zed/config", async (_req, res) => {
    const s = await getSettings(prisma);
    res.json({ enabled: s.zedEnabled, color: s.zedButtonColor });
  });

  // Modules du bouton « Services » (feuille de l'appli client). Lu à chaque ouverture de l'appli : réponse servie
  // depuis un cache en mémoire (30 s) et 304 sans corps si le téléphone a déjà la même version (no-cache + ETag :
  // un changement dans l'admin se voit au lancement suivant). Une seule petite lecture de la base par isolat et par demi-minute, quel que soit le trafic.
  app.get("/api/services", async (req, res) => {
    const { value, etag } = await publicServices(prisma);
    res.set({ ETag: etag, "Cache-Control": "no-cache" });
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }
    res.json(value);
  });

  // Vitesse réelle des pages (Core Web Vitals), envoyée par les téléphones.
  app.use("/api/vitals", limitFor(["POST"], limits.lookup));
  app.use("/api", vitalsRouter(prisma));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const secret = config.adminSecret ?? "";
  const notifier = config.notifier ?? silentNotifier;
  const devCodes = config.otpDevCodes ?? false;
  const files = config.files ?? memoryStore();
  app.use("/api", tableCallPublicRouter(prisma, notifier));
  // Toute écriture de l'admin ou d'un restaurant (carte, horaires, fermeture, promotions…) vide le cache des lectures
  // publiques de cette instance : le client voit le changement tout de suite.
  app.use(["/api/admin", "/api/restaurant"], (req, res, next) => {
    if (req.method !== "GET") res.on("finish", invalidateCatalog);
    next();
  });
  const catalog = catalogCache(prisma, config.catalogCacheMs ?? 0);
  app.use("/api", publicRouter(prisma, { zedekaWhatsapp: config.zedekaWhatsapp, secret, notifier, frontendOrigin: config.frontendOrigin, catalog }));
  app.use("/api", positionRouter(prisma, { secret, notifier, frontendOrigin: config.frontendOrigin }));
  app.use("/api/customer", customerRouter(prisma, { secret, verifier: config.phoneVerifier, devCodes, email: config.emailSender, notifier }));
  app.use("/api/livreur", driverAppRouter(prisma, { secret, notifier, verifier: config.phoneVerifier, devCodes, dispatchPhone: config.zedekaWhatsapp ?? "", email: config.emailSender, files }));

  app.use("/api", partnerLogoRouter(prisma, { files }));
  app.use("/api", mediaRouter({ files }));
  app.use("/api", publicAdsRouter(prisma));
  app.use(
    "/api/admin",
    adminRouter(prisma, { adminPassword: config.adminPassword ?? "", adminSecret: config.adminSecret ?? "", files, notifier, access: config.access ?? { config: null, required: false, emails: [] }, frontendOrigin: config.frontendOrigin }),
  );

  app.use("/api/marchand", merchantAppRouter(prisma, { secret, notifier, frontendOrigin: config.frontendOrigin }));

  app.use("/api/restaurant", restaurantPanelRouter(prisma, { secret, notifier, devCodes, files, frontendOrigin: config.frontendOrigin, email: config.emailSender }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
  });

  return app;
}
