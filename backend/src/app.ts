import "./zodFr.js";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { adminRouter } from "./routes/admin.js";
import { customerRouter } from "./routes/customer.js";
import type { PhoneVerifier } from "./otp.js";
import { publicRouter } from "./routes/public.js";
import { driverAppRouter } from "./routes/driverApp.js";
import { restaurantPanelRouter } from "./routes/restaurantPanel.js";
import { vendorApplicationsRouter } from "./routes/vendorApplications.js";
import { partnerLogoRouter } from "./routes/adminVendors.js";
import { silentNotifier, type Notifier } from "./notify.js";
import { memoryStore, type FileStore } from "./storage.js";
import type { AdminAccess } from "./access.js";

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
  notifier?: Notifier;
};

export function createApp(prisma: PrismaClient, config: Config) {
  const app = express();
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const secret = config.adminSecret ?? "";
  const notifier = config.notifier ?? silentNotifier;
  const devCodes = config.otpDevCodes ?? false;
  const files = config.files ?? memoryStore();
  app.use("/api", publicRouter(prisma, { zedekaWhatsapp: config.zedekaWhatsapp, secret, notifier }));
  app.use("/api/customer", customerRouter(prisma, { secret, verifier: config.phoneVerifier, devCodes }));
  app.use("/api/livreur", driverAppRouter(prisma, { secret, notifier, verifier: config.phoneVerifier, devCodes, dispatchPhone: config.zedekaWhatsapp ?? "" }));

  app.use("/api", vendorApplicationsRouter(prisma, { files }));
  app.use("/api", partnerLogoRouter(prisma, { files }));
  app.use(
    "/api/admin",
    adminRouter(prisma, { adminPassword: config.adminPassword ?? "", adminSecret: config.adminSecret ?? "", files, notifier, access: config.access ?? { config: null, required: false, emails: [] } }),
  );

  app.use("/api/restaurant", restaurantPanelRouter(prisma, { secret, notifier, devCodes }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
  });

  return app;
}
