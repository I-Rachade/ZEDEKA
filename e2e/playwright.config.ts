import { defineConfig, devices } from "@playwright/test";
import { API_PORT, WEB_PORT } from "./env.mjs";

// Tests de bout en bout : le vrai site (next dev) devant la vraie API (wrangler dev, base D1 locale neuve).
// Les deux serveurs sont lancés par Playwright ; voir README.md de ce dossier.
const ci = !!process.env.CI;

export default defineConfig({
  testDir: "tests",
  // Une seule base partagée : les fichiers tournent l'un après l'autre, chaque test crée ses propres données.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: ci ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    locale: "fr-FR",
    timezoneId: "Africa/Lome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // next dev compile chaque page à la première visite.
    navigationTimeout: 60_000,
  },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "node scripts/start-api.mjs",
      url: `http://localhost:${API_PORT}/api/health`,
      timeout: 180_000,
      reuseExistingServer: !ci,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: "node scripts/start-web.mjs",
      url: `http://localhost:${WEB_PORT}/app`,
      timeout: 180_000,
      reuseExistingServer: !ci,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
});
