// Lance le site (next dev) une fois l'API prête : next dev relie la liaison de service API à l'instance
// wrangler en cours au démarrage, et prendrait sinon celle d'un lancement précédent, déjà arrêtée.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { API_PORT, WEB_PORT } from "../env.mjs";

const frontend = fileURLToPath(new URL("../../frontend/", import.meta.url));
const deadline = Date.now() + 180_000;
for (;;) {
  const ok = await fetch(`http://localhost:${API_PORT}/api/health`).then((r) => r.ok, () => false);
  if (ok) break;
  if (Date.now() > deadline) throw new Error(`API injoignable sur le port ${API_PORT}`);
  await new Promise((r) => setTimeout(r, 1000));
}

const web = spawn(`${frontend}node_modules/.bin/next`, ["dev", "-p", String(WEB_PORT)], {
  cwd: frontend,
  stdio: "inherit",
  env: { ...process.env, API_ORIGIN: `http://localhost:${API_PORT}` },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => web.kill(signal));
web.on("exit", (code) => process.exit(code ?? 0));
