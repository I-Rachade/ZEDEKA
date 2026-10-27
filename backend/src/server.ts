import { createApp } from "./app.js";
import { join } from "node:path";
import { startAlertLoop } from "./alerts.js";
import { prisma } from "./db.js";
import { createNotifier } from "./notify.js";
import { configProblems, otpDevCodes } from "./config.js";

const problems = configProblems(process.env);
if (problems.length) {
  const message = `Configuration à corriger :\n- ${problems.join("\n- ")}`;
  if (process.env.NODE_ENV === "production") {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message}\n(accepté hors production)`);
}

const port = Number(process.env.PORT ?? 4000);
const uploadDir = process.env.UPLOAD_DIR ?? "uploads";
const notifier = createNotifier(prisma, { keysFile: process.env.VAPID_KEYS_FILE ?? join(uploadDir, "..", "vapid.json"), contact: process.env.VAPID_CONTACT });
startAlertLoop(prisma, notifier);

const app = createApp(prisma, {
  notifier,
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  zedekaWhatsapp: process.env.ZEDEKA_WHATSAPP ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminSecret: process.env.ADMIN_SECRET ?? "",
  uploadDir,
  otpDevCodes: otpDevCodes(process.env),
  trustProxy: process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : undefined,
});

app.listen(port, () => {
  console.log(`API Zedeka sur http://localhost:${port}`);
});
