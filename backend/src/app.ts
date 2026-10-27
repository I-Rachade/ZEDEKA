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
