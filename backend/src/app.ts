import "./zodFr.js";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { adminRouter } from "./routes/admin.js";
import { publicRouter } from "./routes/public.js";
import { rentalPanelRouter } from "./routes/rentalPanel.js";
import { rentalPublicRouter } from "./routes/rentalPublic.js";
import { restaurantPanelRouter } from "./routes/restaurantPanel.js";
import { vendorApplicationsRouter } from "./routes/vendorApplications.js";
import { partnerLogoRouter } from "./routes/adminVendors.js";

type Config = {
  frontendOrigin: string;
  zedekaWhatsapp: string;
  adminPassword?: string;
  adminSecret?: string;
  uploadDir?: string;
};

export function createApp(prisma: PrismaClient, config: Config) {
  const app = express();
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api", publicRouter(prisma, { zedekaWhatsapp: config.zedekaWhatsapp }));
  app.use("/api", rentalPublicRouter(prisma, { zedekaWhatsapp: config.zedekaWhatsapp }));

  app.use("/api", vendorApplicationsRouter(prisma, { uploadDir: config.uploadDir ?? "uploads" }));
  app.use("/api", partnerLogoRouter(prisma, { uploadDir: config.uploadDir ?? "uploads" }));
  app.use(
    "/api/admin",
    adminRouter(prisma, { adminPassword: config.adminPassword ?? "", adminSecret: config.adminSecret ?? "", uploadDir: config.uploadDir ?? "uploads" }),
  );

  app.use("/api/restaurant", restaurantPanelRouter(prisma, { secret: config.adminSecret ?? "" }));
  app.use("/api/location", rentalPanelRouter(prisma, { secret: config.adminSecret ?? "" }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Erreur interne" });
  });

  return app;
}
