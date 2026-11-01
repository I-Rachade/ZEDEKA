import "./zodFr.js";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { adminRouter } from "./routes/admin.js";
import { customerRouter } from "./routes/customer.js";
import type { EmailSender } from "./email.js";
import type { PhoneVerifier } from "./otp.js";
import { publicRouter } from "./routes/public.js";
import { positionRouter } from "./routes/position.js";
import { driverAppRouter } from "./routes/driverApp.js";
import { restaurantPanelRouter } from "./routes/restaurantPanel.js";
import { vendorApplicationsRouter } from "./routes/vendorApplications.js";
import { partnerLogoRouter } from "./routes/adminVendors.js";
import { silentNotifier, type Notifier } from "./notify.js";
import { memoryStore, type FileStore } from "./storage.js";
import type { AdminAccess } from "./access.js";
import { limitFor, type Limiters } from "./rateLimit.js";
import { i18nResponses } from "./i18n.js";

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
};

export function createApp(prisma: PrismaClient, config: Config) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    next();
  });
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json({ limit: "100kb" }));
  app.use(i18nResponses);

  const limits = config.limiters ?? {};
  // Mots de passe (admin, restaurants) et codes de réinitialisation.
  app.use(["/api/admin/login", "/api/restaurant/login", "/api/restaurant/password", "/api/customer/pin"], limitFor(["POST"], limits.login));
  // Codes SMS des clients et des livreurs (les limites par numéro de otp.ts s'ajoutent à celle-ci).
  app.use(["/api/customer/otp", "/api/customer/email", "/api/livreur/otp", "/api/livreur/email"], limitFor(["POST"], limits.otp));
  // Suivi par code : empêche de parcourir les codes de commande.
  app.use("/api/orders", limitFor(["GET"], limits.lookup));
  app.use("/api/track", limitFor(["POST"], limits.lookup));
  app.use("/api/places", limitFor(["GET"], limits.lookup));
  // Liens de position envoyés aux destinataires de colis.
  app.use(["/api/position", "/api/location-requests"], limitFor(["GET", "POST"], limits.lookup));
  // Formulaires publics : commandes, colis, candidatures.
  app.use(["/api/orders", "/api/parcels", "/api/drivers/apply", "/api/maps-link"], limitFor(["POST"], limits.forms));
  app.use("/api/vendor-applications", limitFor(["POST"], limits.applications));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const secret = config.adminSecret ?? "";
  const notifier = config.notifier ?? silentNotifier;
  const devCodes = config.otpDevCodes ?? false;
  const files = config.files ?? memoryStore();
  app.use("/api", publicRouter(prisma, { zedekaWhatsapp: config.zedekaWhatsapp, secret, notifier, frontendOrigin: config.frontendOrigin }));
  app.use("/api", positionRouter(prisma, { secret, notifier, frontendOrigin: config.frontendOrigin }));
  app.use("/api/customer", customerRouter(prisma, { secret, verifier: config.phoneVerifier, devCodes, email: config.emailSender }));
  app.use("/api/livreur", driverAppRouter(prisma, { secret, notifier, verifier: config.phoneVerifier, devCodes, dispatchPhone: config.zedekaWhatsapp ?? "", email: config.emailSender }));

  app.use("/api", vendorApplicationsRouter(prisma, { files, notifier }));
  app.use("/api", partnerLogoRouter(prisma, { files }));
  app.use(
    "/api/admin",
    adminRouter(prisma, { adminPassword: config.adminPassword ?? "", adminSecret: config.adminSecret ?? "", files, notifier, access: config.access ?? { config: null, required: false, emails: [] }, frontendOrigin: config.frontendOrigin }),
  );

  app.use("/api/restaurant", restaurantPanelRouter(prisma, { secret, notifier, devCodes }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
  });

  return app;
}
