import { createApp } from "./app.js";
import { prisma } from "./db.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp(prisma, {
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  zedekaWhatsapp: process.env.ZEDEKA_WHATSAPP ?? "",
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
});

app.listen(port, () => {
  console.log(`API Zedeka sur http://localhost:${port}`);
});
