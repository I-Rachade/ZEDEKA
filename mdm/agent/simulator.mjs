#!/usr/bin/env node
/**
 * Simulateur de parc + implémentation de référence du protocole agent.
 *
 * Usage :
 *   MDM_URL=http://localhost:8787 SETUP_TOKEN=... node agent/simulator.mjs --seed   # crée comptes, catalogue, 24 appareils
 *   MDM_URL=http://localhost:8787 node agent/simulator.mjs --run                     # fait vivre le parc (check-in, commandes)
 *
 * Un vrai agent Android/iOS suit exactement la même séquence :
 *   1. POST /agent/enroll            { enrollment_token, device }      → device_token
 *   2. POST /agent/checkin           inventaire (+ position si demandé) → commandes en attente + politiques
 *   3. POST /agent/commands/:id/result  résultat de chaque commande
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const URL_ = process.env.MDM_URL ?? "http://localhost:8787";
const STATE = process.env.SIM_STATE ?? ".simulator-state.json";
const ADMIN = { email: process.env.ADMIN_EMAIL ?? "admin@entreprise.fr", password: process.env.ADMIN_PASSWORD ?? "Admin!MDM-2026", name: "Administrateur MDM" };
const NETWORK_TOKEN = process.env.NETWORK_TOKEN ?? "jeton-partage-avec-le-controleur-wifi";

async function call(path, { method = "GET", body, token, headers = {} } = {}) {
  const r = await fetch(URL_ + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${data.error ?? ""}`);
  return data;
}

// ------------------------------------------------------------------ données de démonstration
const SITES = [[48.8738, 2.2950], [48.8919, 2.2381], [45.7606, 4.8590], [43.3110, 5.3690], [50.6372, 3.0750], [47.2063, -1.5550]];
const PEOPLE = [
  ["Claire Martin", "claire.martin@entreprise.fr"], ["Kofi Diallo", "kofi.diallo@entreprise.fr"], ["Julien Bernard", "julien.bernard@entreprise.fr"],
  ["Sophie Laurent", "sophie.laurent@entreprise.fr"], ["Amina Benali", "amina.benali@entreprise.fr"], ["Thomas Petit", "thomas.petit@entreprise.fr"],
  ["Léa Moreau", "lea.moreau@entreprise.fr"], ["Hugo Garcia", "hugo.garcia@entreprise.fr"], ["Inès Robert", "ines.robert@entreprise.fr"],
  ["Nicolas Faure", "nicolas.faure@entreprise.fr"], ["Fatou Ndiaye", "fatou.ndiaye@entreprise.fr"], ["Lucas Roux", "lucas.roux@entreprise.fr"],
];
const MODELS = {
  android: [["Samsung Galaxy S24", "14"], ["Samsung Galaxy A55", "14"], ["Google Pixel 8", "15"], ["Samsung Galaxy Tab S9", "14"], ["Samsung Galaxy XCover 7", "14"]],
  ios: [["iPhone 15", "18.1"], ["iPhone 14", "17.6"], ["iPhone SE (3e gén.)", "18.1"], ["iPad Air (M2)", "18.1"]],
};
const CATALOG = [
  ["Microsoft Teams", "com.microsoft.teams", "6.18", "Communication", 1], ["Microsoft Outlook", "com.microsoft.office.outlook", "4.2445", "Messagerie", 1],
  ["Microsoft Authenticator", "com.azure.authenticator", "6.2410", "Sécurité", 0], ["GlobalProtect VPN", "com.paloaltonetworks.globalprotect", "6.3", "Sécurité", 0],
  ["Adobe Acrobat Reader", "com.adobe.reader", "24.10", "Bureautique", 0], ["Webex Meetings", "com.cisco.webex.meetings", "45.1", "Communication", 0],
];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mac = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join(":");

async function seed() {
  try { await call("/api/setup", { method: "POST", body: { setup_token: process.env.SETUP_TOKEN, ...ADMIN } }); console.log("✓ Administrateur créé"); }
  catch (e) { console.log("· Installation déjà faite :", e.message); }
  const { token } = await call("/api/auth/login", { method: "POST", body: ADMIN });

  for (const [name, email] of PEOPLE)
    await call("/api/users", { method: "POST", token, body: { name, email, role: "user", password: "Utilisateur!2026" } }).catch(() => {});
  console.log(`✓ ${PEOPLE.length} utilisateurs (mot de passe : Utilisateur!2026)`);

  for (const [name, id, version, category, mandatory] of CATALOG)
    for (const platform of ["android", "ios"])
      await call("/api/apps", { method: "POST", token, body: { name, identifier: id, platform, version, category, mandatory: !!mandatory } }).catch(() => {});
  await call("/api/apps", { method: "POST", token, body: { name: "TikTok", identifier: "com.zhiliaoapp.musically", platform: "android", category: "Réseau social", blocked: true } }).catch(() => {});
  await call("/api/apps", { method: "POST", token, body: { name: "CRM Terrain (interne)", identifier: "fr.entreprise.crm", platform: "android", version: "3.4.1", source: "entreprise", download_url: "https://apps.entreprise.fr/crm-3.4.1.apk", category: "Métier" } }).catch(() => {});
  console.log("✓ Catalogue d'applications");

  const devices = [];
  for (let i = 0; i < 24; i++) {
    const platform = i % 3 === 2 ? "ios" : "android";
    const [model, os] = pick(MODELS[platform]);
    const [person, email] = PEOPLE[i % PEOPLE.length];
    const ownership = i % 5 === 0 ? "personnel" : "entreprise";
    const { enroll_url } = await call("/api/enrollment/tokens", { method: "POST", token, body: { owner_email: email, platform, ownership } });
    const enrollment_token = new URL(enroll_url).searchParams.get("t");
    const name = `${platform === "android" ? "AND" : "IOS"}-${person.split(" ")[1].toUpperCase().slice(0, 6)}-${String(i + 1).padStart(2, "0")}`;
    const wifi_mac = mac();
    const r = await call("/agent/enroll", { method: "POST", body: { enrollment_token, device: {
      name, platform, model, os_version: os, serial: `SN${Math.floor(rnd(1e9, 1e10))}`, imei: `35${Math.floor(rnd(1e12, 1e13))}`, wifi_mac } } });
    const [lat, lon] = SITES[i % SITES.length];
    devices.push({
      id: r.device_id, token: r.device_token, name, platform, os_version: os, wifi_mac, lat: lat + rnd(-.03, .03), lon: lon + rnd(-.03, .03),
      battery: Math.floor(rnd(20, 100)), storage: Math.floor(rnd(20, 95)), data: Math.floor(rnd(300, 9000)),
      encrypted: i !== 7, passcode: i !== 10, rooted: i === 4,
      apps: CATALOG.filter((c, k) => c[4] || (k + i) % 3 === 0).filter((c) => !(i === 13 && c[1] === "com.microsoft.teams"))
        .map(([n, id, v]) => ({ identifier: id, name: n, version: v })).concat(i === 16 && platform === "android" ? [{ identifier: "com.zhiliaoapp.musically", name: "TikTok", version: "37.1" }] : []),
    });
  }
  if (devices[20]) devices[20].os_version = devices[20].platform === "ios" ? "15.8" : "9";
  writeFileSync(STATE, JSON.stringify({ devices }, null, 2));
  console.log(`✓ ${devices.length} appareils enrôlés`);

  for (const d of devices) await checkin(d);
  console.log("✓ Premier inventaire remonté");

  // Scénarios de démonstration : perte, localisation motivée, hors zone, connexion réseau
  const lost = devices[21];
  await call(`/api/devices/${lost.id}/commands`, { method: "POST", token, body: { type: "lost_mode_on", reason: "Vol signalé par l'utilisateur (ticket #4521)" } });
  for (const d of devices.slice(0, 18)) await call(`/api/devices/${d.id}/commands`, { method: "POST", token, body: { type: "locate", reason: "Inventaire trimestriel des équipements" } });
  devices[19].lat = 40.4168; devices[19].lon = -3.7038; // déplacement à Madrid
  await call(`/api/devices/${devices[19].id}/commands`, { method: "POST", token, body: { type: "locate", reason: "Contrôle suite à alerte d'itinérance" } });
  await call(`/api/devices/${devices[2].id}/commands`, { method: "POST", token, body: { type: "lock" } });
  for (const d of devices) await checkin(d);

  const net = (body) => call("/api/network/events", { method: "POST", headers: { "x-network-token": NETWORK_TOKEN }, body });
  console.log("· Réseau, appareil connu   :", (await net({ mac: devices[0].wifi_mac, ip: "10.20.1.15", ssid: "ENTREPRISE-PRO", username: "claire.martin" })).decision);
  console.log("· Réseau, appareil inconnu :", (await net({ mac: mac(), ip: "10.20.1.99", ssid: "ENTREPRISE-PRO", username: "kofi.diallo" })).decision);
  console.log("· Réseau, appareil perdu   :", (await net({ mac: lost.wifi_mac, ip: "10.20.4.31", ssid: "ENTREPRISE-INVITES" })).decision);
  console.log("· Réseau, non conforme     :", (await net({ mac: devices[4].wifi_mac, ip: "10.20.2.40", ssid: "ENTREPRISE-PRO" })).decision);
  console.log(`\nConsole : ${URL_}  —  ${ADMIN.email} / ${ADMIN.password}`);
}

// ------------------------------------------------------------------ comportement d'un agent
async function checkin(d) {
  const res = await call("/agent/checkin", { method: "POST", token: d.token, body: {
    inventory: { os_version: d.os_version, battery: d.battery, storage_used_pct: d.storage, data_usage_mb: d.data,
      encrypted: d.encrypted, passcode_set: d.passcode, rooted: d.rooted, wifi_mac: d.wifi_mac },
    apps: d.apps,
    location: d.reportLocation ? { lat: d.lat, lon: d.lon, accuracy: rnd(5, 40), source: pick(["gps", "wifi"]) } : undefined,
  } });
  d.reportLocation = res.report_location;
  for (const cmd of res.commands) {
    let result = { ok: true }, location;
    switch (cmd.type) {
      case "locate": location = { lat: d.lat, lon: d.lon, accuracy: rnd(5, 40), source: pick(["gps", "wifi"]) }; break;
      case "install_app": d.apps = d.apps.filter((a) => a.identifier !== cmd.params.identifier).concat([{ identifier: cmd.params.identifier, name: cmd.params.name, version: cmd.params.version }]); break;
      case "remove_app": d.apps = d.apps.filter((a) => a.identifier !== cmd.params.identifier); break;
      case "reset_passcode": d.passcode = true; break;
      case "sync_policy": if (res.policies.passcode) d.passcode = true; break;
    }
    await call(`/agent/commands/${cmd.id}/result`, { method: "POST", token: d.token, body: { status: "terminée", result, location } });
  }
  return res;
}

async function run() {
  if (!existsSync(STATE)) throw new Error("Lancez d'abord --seed");
  const { devices } = JSON.parse(readFileSync(STATE, "utf8"));
  console.log(`Simulation de ${devices.length} appareils (Ctrl+C pour arrêter)…`);
  for (;;) {
    for (const d of devices) {
      d.battery = Math.max(5, Math.min(100, d.battery + Math.round(rnd(-4, 3))));
      d.lat += rnd(-.002, .002); d.lon += rnd(-.002, .002);
      try { await checkin(d); } catch (e) { if (!/retiré|inconnu/.test(e.message)) console.error(d.name, e.message); }
    }
    writeFileSync(STATE, JSON.stringify({ devices }, null, 2));
    await new Promise((r) => setTimeout(r, Number(process.env.SIM_INTERVAL_MS ?? 15000)));
  }
}

const mode = process.argv[2];
(mode === "--seed" ? seed() : mode === "--run" ? run() : Promise.reject(new Error("Usage : --seed | --run")))
  .catch((e) => { console.error("✗", e.message); process.exit(1); });
