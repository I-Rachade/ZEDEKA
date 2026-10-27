import "./zodFr.js";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { adminRouter } from "./routes/admin.js";
import { customerRouter, type OtpSender } from "./routes/customer.js";
import { publicRouter } from "./routes/public.js";
import { rentalPanelRouter } from "./routes/rentalPanel.js";
import { rentalPublicRouter } from "./routes/rentalPublic.js";
import { driverAppRouter } from "./routes/driverApp.js";
import { restaurantPanelRouter } from "./routes/restaurantPanel.js";
import { vendorApplicationsRouter } from "./routes/vendorApplications.js";
import { partnerLogoRouter } from "./routes/adminVendors.js";
import { silentNotifier, type Notifier } from "./notify.js";
import { onlyFor, rateLimit } from "./rateLimit.js";

type Config = {
  frontendOrigin: string;
  zedekaWhatsapp: string;
  adminPassword?: string;
  adminSecret?: string;
  uploadDir?: string;
  sendOtp?: OtpSender;
  // Sans fournisseur SMS/WhatsApp, renvoyer le code dans la réponse (développement et tests uniquement).
  otpDevCodes?: boolean;
  notifier?: Notifier;
  // Valeur Express « trust proxy » (ex. 1 derrière nginx) pour lire la vraie adresse IP des clients.
  trustProxy?: string | number | boolean;
  // Limites de requêtes par IP (désactivables pour les tests de charge uniquement).
  rateLimits?: boolean;
};

export function createApp(prisma: PrismaClient, config: Config) {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxy !== undefined) app.set("trust proxy", config.trustProxy);
  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
    next();
  });
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json({ limit: "100kb" }));

  if (config.rateLimits ?? true) {
    const minutes = (n: number) => n * 60_000;
    // Mots de passe (admin, restaurants, loueurs) et codes de réinitialisation.
    const login = rateLimit({ windowMs: minutes(15), max: 20 });
    app.use(["/api/admin/login", "/api/restaurant/login", "/api/location/login", "/api/restaurant/password", "/api/location/password"], onlyFor(["POST"], login));
    // Codes SMS des clients et des livreurs (les limites par numéro s'ajoutent à celle-ci).
    app.use(["/api/customer/otp", "/api/livreur/otp"], onlyFor(["POST"], rateLimit({ windowMs: minutes(15), max: 30 })));
    // Suivi par code : empêche de parcourir tous les codes de commande et de réservation.
    const lookup = rateLimit({ windowMs: minutes(15), max: 120 });
    app.use(["/api/orders", "/api/trips"], onlyFor(["GET"], lookup));
    app.use("/api/track", onlyFor(["POST"], lookup));
    // Formulaires publics : commandes, colis, réservations, candidatures.
    app.use(["/api/orders", "/api/parcels", "/api/trips", "/api/drivers/apply"], onlyFor(["POST"], rateLimit({ windowMs: minutes(15), max: 60 })));
    app.use("/api/vendor-applications", onlyFor(["POST"], rateLimit({ windowMs: minutes(60), max: 10 })));
  }

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const secret = config.adminSecret ?? "";
  const notifier = config.notifier ?? silentNotifier;
  const devCodes = config.otpDevCodes ?? false;
  app.use("/api", publicRouter(prisma, { zedekaWhatsapp: config.zedekaWhatsapp, secret, notifier }));
  app.use("/api", rentalPublicRouter(prisma, { zedekaWhatsapp: config.zedekaWhatsapp, secret, notifier }));
  app.use("/api/customer", customerRouter(prisma, { secret, sendOtp: config.sendOtp, devCodes: config.otpDevCodes ?? false }));
  app.use("/api/livreur", driverAppRouter(prisma, { secret, notifier, sendOtp: config.sendOtp, devCodes, dispatchPhone: config.zedekaWhatsapp ?? "" }));

  app.use("/api", vendorApplicationsRouter(prisma, { uploadDir: config.uploadDir ?? "uploads" }));
  app.use("/api", partnerLogoRouter(prisma, { uploadDir: config.uploadDir ?? "uploads" }));
  app.use(
    "/api/admin",
    adminRouter(prisma, { adminPassword: config.adminPassword ?? "", adminSecret: config.adminSecret ?? "", uploadDir: config.uploadDir ?? "uploads", notifier }),
  );

  app.use("/api/restaurant", restaurantPanelRouter(prisma, { secret, notifier, devCodes }));
  app.use("/api/location", rentalPanelRouter(prisma, { secret, notifier, devCodes }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
  });

  return app;
}
