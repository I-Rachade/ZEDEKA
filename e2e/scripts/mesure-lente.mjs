// Mesure des pages clés comme sur un téléphone d'entrée de gamme en 4G lente : réseau ralenti (150 ms, 1,6 Mbit/s)
// et processeur ralenti 4 fois. Par défaut sur le site en ligne ; une autre adresse en argument (ex. http://localhost:3000).
//   node scripts/mesure-lente.mjs [adresse]
// Affiche, pour chaque page, le temps de première réponse (TTFB), le premier affichage (FCP), le plus grand élément
// affiché (LCP), le poids téléchargé et le nombre de requêtes ; plus la compression des réponses.
// Dans GitHub Actions, le tableau est aussi écrit dans le résumé de l'exécution.
import { chromium, devices } from "@playwright/test";
import { appendFileSync } from "node:fs";

const BASE = (process.argv[2] ?? process.env.MESURE_URL ?? "https://zedeka.poinderecharge.com").replace(/\/$/, "");
const NETWORK = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU = 4;

async function firstRestaurant() {
  try {
    const res = await fetch(`${BASE}/api/restaurants`);
    const list = await res.json();
    return Array.isArray(list) && list[0]?.slug ? list[0].slug : null;
  } catch {
    return null;
  }
}

async function compression(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { "accept-encoding": "br, gzip" } });
  return res.headers.get("content-encoding") ?? "aucune";
}

async function measure(browser, path, { warm = false } = {}) {
  const context = await browser.newContext({ ...devices["Moto G4"], locale: "fr-FR" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", NETWORK);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.addInitScript(() => {
    window.__lcp = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  if (warm) await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => {});
  let bytes = 0;
  let requests = 0;
  cdp.on("Network.loadingFinished", (e) => {
    bytes += e.encodedDataLength;
    requests += 1;
  });
  const started = Date.now();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => {});
  const total = Date.now() - started;
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return { ttfb: nav ? nav.responseStart : 0, fcp: fcp ? fcp.startTime : 0, lcp: window.__lcp };
  });
  await context.close();
  return { path: warm ? `${path} (réouverture)` : path, ...m, total, kb: Math.round(bytes / 1024), requests };
}

const s = (ms) => `${(ms / 1000).toFixed(1)} s`;

const slug = await firstRestaurant();
const pages = ["/app", ...(slug ? [`/r/${slug}`] : []), "/colis", "/suivi"];
const browser = await chromium.launch();
const rows = [];
for (const p of pages) rows.push(await measure(browser, p));
rows.push(await measure(browser, "/app", { warm: true }));
await browser.close();

const lines = [
  `### Téléphone lent (4G lente, processeur ÷${CPU}) — ${BASE}`,
  "",
  "| Page | TTFB | Premier affichage | Plus grand élément | Chargement complet | Poids | Requêtes |",
  "|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.path} | ${s(r.ttfb)} | ${s(r.fcp)} | ${s(r.lcp)} | ${s(r.total)} | ${r.kb} Ko | ${r.requests} |`),
  "",
  `Compression : page ${await compression("/app").catch(() => "?")}, API ${await compression("/api/zones").catch(() => "?")}.`,
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
