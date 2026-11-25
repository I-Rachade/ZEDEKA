/**
 * Plateforme MDM — point d'entrée du Worker Cloudflare.
 *
 *  /api/*       API du portail (JSON, authentification JWT, rôles admin / utilisateur)
 *  /agent/*     API des appareils (agent compagnon Android / iOS)
 *  /mdm/apple/* Protocole MDM natif Apple
 *  /enroll      Page d'enrôlement (portail captif, invitation)
 *  le reste     Tableau de bord (fichiers statiques de ./public)
 */
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { AppEnv, Env } from "./env";
import { runAlertRules, runRetention } from "./lib/services";
import { HttpError } from "./lib/util";
import { adminRoutes } from "./routes/admin";
import { agentRoutes } from "./routes/agent";
import { authRoutes } from "./routes/auth";
import { deviceRoutes } from "./routes/devices";

const app = new Hono<AppEnv>();

app.use("*", secureHeaders({
  strictTransportSecurity: "max-age=63072000; includeSubDomains",
  xFrameOptions: "DENY",
  referrerPolicy: "no-referrer",
}));

// Refuse le démarrage si les secrets indispensables manquent
app.use("*", async (c, next) => {
  if (!c.env.JWT_SECRET || c.env.JWT_SECRET.length < 32 || !c.env.DATA_KEY)
    return c.json({ error: "Configuration incomplète : définir les secrets JWT_SECRET (32+ caractères) et DATA_KEY" }, 500);
  await next();
});

app.get("/api/health", (c) => c.json({ ok: true, org: c.env.ORG_NAME, location_mode: c.env.LOCATION_MODE }));
app.route("/", agentRoutes);   // /agent/*, /api/network/events, /mdm/apple/*, /enroll
app.route("/api", authRoutes);
app.route("/api", deviceRoutes);
app.route("/api", adminRoutes);

app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "Route inconnue" }, 404) : c.env.ASSETS.fetch(c.req.raw)));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Erreur interne" }, 500);
});

export default {
  fetch: app.fetch,
  /** Tâches planifiées (Cron Triggers) : règles d'alerte et purge RGPD. */
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "0 3 * * *") ctx.waitUntil(runRetention(env));
    else ctx.waitUntil(runAlertRules(env));
  },
} satisfies ExportedHandler<Env>;
