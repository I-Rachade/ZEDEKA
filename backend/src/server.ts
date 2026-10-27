import { createApp } from "./app.js";
import { prisma } from "./db.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp(prisma, {
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  zedekaWhatsapp: process.env.ZEDEKA_WHATSAPP ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminSecret: process.env.ADMIN_SECRET ?? "",
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  otpDevCodes: process.env.OTP_DEV_CODES === "true" || (process.env.OTP_DEV_CODES === undefined && process.env.NODE_ENV !== "production"),
});

app.listen(port, () => {
  console.log(`API Zedeka sur http://localhost:${port}`);
});
