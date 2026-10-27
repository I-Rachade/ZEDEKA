import { createApp } from "./app.js";
import { join } from "node:path";
import { startAlertLoop } from "./alerts.js";
import { prisma } from "./db.js";
import { createNotifier } from "./notify.js";
import { startRetentionLoop } from "./retention.js";

const port = Number(process.env.PORT ?? 4000);
const uploadDir = process.env.UPLOAD_DIR ?? "uploads";
const notifier = createNotifier(prisma, { keysFile: process.env.VAPID_KEYS_FILE ?? join(uploadDir, "..", "vapid.json"), contact: process.env.VAPID_CONTACT });
startAlertLoop(prisma, notifier);
startRetentionLoop(prisma, uploadDir);

const app = createApp(prisma, {
  notifier,
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  zedekaWhatsapp: process.env.ZEDEKA_WHATSAPP ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminSecret: process.env.ADMIN_SECRET ?? "",
  uploadDir,
  otpDevCodes: process.env.OTP_DEV_CODES === "true" || (process.env.OTP_DEV_CODES === undefined && process.env.NODE_ENV !== "production"),
});

app.listen(port, () => {
  console.log(`API Zedeka sur http://localhost:${port}`);
});
