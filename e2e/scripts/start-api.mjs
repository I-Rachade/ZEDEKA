// Lance l'API pour les tests de bout en bout : base D1 locale neuve (e2e/.state), migrations, données de
// démonstration, puis `wrangler dev` avec des secrets de test. La base de `npm run dev` n'est pas touchée.
import { execFileSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API_PORT, ADMIN_PASSWORD, ADMIN_SECRET, WEB_PORT } from "../env.mjs";

const backend = fileURLToPath(new URL("../../backend/", import.meta.url));
const state = fileURLToPath(new URL("../.state/api", import.meta.url));
const run = (args, env = {}) => execFileSync("npx", args, { cwd: backend, stdio: "inherit", env: { ...process.env, ...env } });

rmSync(state, { recursive: true, force: true });
run(["wrangler", "d1", "migrations", "apply", "zedeka-db", "--local", "--persist-to", state]);
run(["tsx", "prisma/seed.ts"], { SEED_PERSIST_TO: state });

const vars = {
  ZEDEKA_WHATSAPP: "22890000000",
  ADMIN_PASSWORD,
  ADMIN_SECRET,
  OTP_DEV_CODES: "true",
  FRONTEND_ORIGIN: `http://localhost:${WEB_PORT}`,
};
const api = spawn(
  `${backend}node_modules/.bin/wrangler`,
  ["dev", "--port", String(API_PORT), "--inspector-port", "0", "--persist-to", state, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
  { cwd: backend, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => api.kill(signal));
api.on("exit", (code) => process.exit(code ?? 0));
