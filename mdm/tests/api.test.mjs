// Tests d'intégration de l'API. Prérequis : `npm run dev` + `npm run simulate -- --seed` (voir README).
// Lancement : MDM_URL=http://127.0.0.1:8787 npm test
import assert from "node:assert/strict";
import { test } from "node:test";

const URL_ = process.env.MDM_URL ?? "http://127.0.0.1:8787";
const call = async (path, { method = "GET", body, token, headers = {} } = {}) => {
  const r = await fetch(URL_ + path, { method, body: body ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const login = async (email, password) => (await call("/api/auth/login", { method: "POST", body: { email, password } })).data.token;
const admin = await login("admin@entreprise.fr", "Admin!MDM-2026");
const claire = await login("claire.martin@entreprise.fr", "Utilisateur!2026");

test("connexion refusée avec un mauvais mot de passe", async () => {
  assert.equal((await call("/api/auth/login", { method: "POST", body: { email: "lea.moreau@entreprise.fr", password: "faux" } })).status, 401);
});

test("API protégée sans jeton", async () => {
  assert.equal((await call("/api/devices")).status, 401);
});

test("l'administrateur voit tout le parc", async () => {
  const { data } = await call("/api/devices", { token: admin });
  assert.ok(data.length >= 24);
});

test("un utilisateur ne voit que ses appareils", async () => {
  const { data } = await call("/api/devices", { token: claire });
  assert.ok(data.length > 0);
  assert.ok(data.every((d) => d.owner_email === "claire.martin@entreprise.fr"));
});

test("un utilisateur ne peut pas accéder à l'appareil d'un autre", async () => {
  const all = (await call("/api/devices", { token: admin })).data;
  const other = all.find((d) => d.owner_email !== "claire.martin@entreprise.fr");
  assert.equal((await call(`/api/devices/${other.id}`, { token: claire })).status, 403);
});

test("un utilisateur ne peut pas effacer son appareil ni accéder aux écrans admin", async () => {
  const mine = (await call("/api/devices", { token: claire })).data[0];
  assert.equal((await call(`/api/devices/${mine.id}/commands`, { method: "POST", token: claire, body: { type: "wipe_full", reason: "test" } })).status, 403);
  assert.equal((await call("/api/stats", { token: claire })).status, 403);
  assert.equal((await call("/api/users", { token: claire })).status, 403);
});

test("un utilisateur peut verrouiller son propre appareil", async () => {
  const mine = (await call("/api/devices", { token: claire })).data[0];
  assert.equal((await call(`/api/devices/${mine.id}/commands`, { method: "POST", token: claire, body: { type: "lock" } })).status, 202);
});

test("effacement : motif obligatoire", async () => {
  const d = (await call("/api/devices", { token: admin })).data[5];
  assert.equal((await call(`/api/devices/${d.id}/commands`, { method: "POST", token: admin, body: { type: "wipe_full" } })).status, 422);
});

test("localisation par un admin : motif obligatoire (RGPD)", async () => {
  const d = (await call("/api/devices", { token: admin })).data.find((x) => !x.lost_mode);
  assert.equal((await call(`/api/devices/${d.id}/commands`, { method: "POST", token: admin, body: { type: "locate" } })).status, 422);
});

test("conformité détectée (root, chiffrement, code, app interdite, OS)", async () => {
  const { data } = await call("/api/devices?compliant=0", { token: admin });
  const codes = data.flatMap((d) => d.compliance_issues.map((i) => i.code));
  for (const c of ["rooted", "encryption", "passcode", "os"]) assert.ok(codes.includes(c), `problème ${c} attendu`);
});

test("alertes : perte/vol, hors zone et appareil perdu vu sur le réseau", async () => {
  const types = (await call("/api/alerts", { token: admin })).data.map((a) => a.type);
  for (const t of ["perte_vol", "hors_zone", "perdu_detecte_reseau"]) assert.ok(types.includes(t), `alerte ${t} attendue`);
});

test("positions chiffrées et restituées sur la carte", async () => {
  const { data } = await call("/api/map", { token: admin });
  assert.ok(data.length >= 18);
  assert.ok(data.every((p) => typeof p.lat === "number" && typeof p.lon === "number"));
});

test("réseau : jeton obligatoire, MAC inconnue → enrôlement", async () => {
  assert.equal((await call("/api/network/events", { method: "POST", body: { mac: "aa:bb:cc:dd:ee:ff" } })).status, 401);
  const r = await call("/api/network/events", { method: "POST", headers: { "x-network-token": "jeton-partage-avec-le-controleur-wifi" },
    body: { mac: "aa:bb:cc:dd:ee:01", ssid: "ENTREPRISE-PRO", username: "lucas.roux" } });
  assert.equal(r.data.decision, "enrôlement");
  assert.match(r.data.portal_url, /\/enroll\?t=/);
});

test("jeton d'enrôlement à usage unique", async () => {
  const { data } = await call("/api/enrollment/tokens", { method: "POST", token: admin, body: { platform: "android" } });
  const t = new URL(data.enroll_url).searchParams.get("t");
  const dev = { platform: "android", name: "TEST-UNIQUE", model: "Pixel" };
  assert.equal((await call("/agent/enroll", { method: "POST", body: { enrollment_token: t, device: dev } })).status, 201);
  assert.equal((await call("/agent/enroll", { method: "POST", body: { enrollment_token: t, device: dev } })).status, 401);
});

test("politique de mot de passe : validation des bornes", async () => {
  const bad = await call("/api/policies/passcode", { method: "PUT", token: admin, body: { settings: { min_length: 2, max_failed_attempts: 10 } } });
  assert.equal(bad.status, 422);
});

test("mot de passe faible refusé à la création de compte", async () => {
  const r = await call("/api/users", { method: "POST", token: admin, body: { name: "X", email: "x@entreprise.fr", role: "user", password: "azerty" } });
  assert.equal(r.status, 422);
});

test("statistiques du tableau de bord", async () => {
  const { data } = await call("/api/stats", { token: admin });
  assert.ok(data.totals.total >= 24);
  assert.ok(data.byPlatform.length === 2);
});

test("export RGPD de ses propres données", async () => {
  const { data } = await call("/api/me/export", { token: claire });
  assert.equal(data.personne.email, "claire.martin@entreprise.fr");
  assert.ok(Array.isArray(data.appareils));
});

test("protocole Apple : check-in et récupération d'une commande", async () => {
  const { data } = await call("/api/enrollment/tokens", { method: "POST", token: admin, body: { platform: "ios" } });
  const t = new URL(data.enroll_url).searchParams.get("t");
  const udid = `00008110-${Date.now()}`;
  const plist = (o) => `<?xml version="1.0"?><plist version="1.0"><dict>${Object.entries(o).map(([k, v]) => `<key>${k}</key><string>${v}</string>`).join("")}</dict></plist>`;
  const put = (path, body) => fetch(URL_ + path, { method: "PUT", body, headers: { "content-type": "application/x-apple-aspen-mdm-checkin" } });
  assert.equal((await put(`/mdm/apple/checkin?t=${t}`, plist({ MessageType: "Authenticate", UDID: udid, DeviceName: "iPhone de test", OSVersion: "18.1", SerialNumber: `F${Date.now()}` }))).status, 200);
  assert.equal((await call(`/api/devices/${udid}/commands`, { method: "POST", token: admin, body: { type: "lock" } })).status, 202);
  const res = await put("/mdm/apple/server", plist({ UDID: udid, Status: "Idle" }));
  const xml = await res.text();
  assert.match(xml, /DeviceLock/);
});

test("ouverture depuis le back-office Zedeka (jeton signé, usage unique)", async (t) => {
  const secret = process.env.SSO_SECRET;
  if (!secret) return t.skip("SSO_SECRET non fourni");
  const { createHmac, randomUUID } = await import("node:crypto");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims) => {
    const h = b64({ alg: "HS256", typ: "JWT" }), b = b64(claims);
    return `${h}.${b}.${createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`;
  };
  const token = sign({ iss: "zedeka", aud: "mdm", iat: now, exp: now + 60, jti: randomUUID(), email: "direction@zedeka.invalid", name: "Direction", role: "admin" });
  const ok = await call("/api/auth/sso", { method: "POST", body: { token } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, "admin");
  assert.equal((await call("/api/stats", { token: ok.data.token })).status, 200);
  assert.equal((await call("/api/auth/sso", { method: "POST", body: { token } })).status, 401); // usage unique
  const expired = sign({ iss: "zedeka", aud: "mdm", iat: now - 120, exp: now - 60, jti: randomUUID(), email: "x@y.z", role: "admin" });
  assert.equal((await call("/api/auth/sso", { method: "POST", body: { token: expired } })).status, 401);
  const forged = token.slice(0, -4) + "AAAA";
  assert.equal((await call("/api/auth/sso", { method: "POST", body: { token: forged } })).status, 401);
});

test("agent Android : enrôlement, check-in (propriété), puis l'utilisateur quitte la gestion", async () => {
  const { data: tok } = await call("/api/enrollment/tokens", { method: "POST", token: admin,
    body: { owner_email: "claire.martin@entreprise.fr", platform: "android", ownership: "personnel" } });
  const enrollment_token = new URL(tok.enroll_url).searchParams.get("t");
  const page = await fetch(`${URL_}/enroll?t=${enrollment_token}`).then((r) => r.text());
  assert.match(page, /zedekamdm:\/\/enroll\?server=/);
  const { status, data: dev } = await call("/agent/enroll", { method: "POST",
    body: { enrollment_token, device: { platform: "android", management: "agent", name: "AND-AGENT-TEST", model: "Pixel 8", os_version: "15" } } });
  assert.equal(status, 201);
  const { data: res } = await call("/agent/checkin", { method: "POST", token: dev.device_token,
    body: { inventory: { battery: 80, encrypted: true, passcode_set: true, rooted: false }, apps: [] } });
  assert.equal(res.ownership, "personnel");
  assert.ok(dev.unlock_secret);
  // Sonde : une commande en file est signalée tout de suite
  await call(`/api/devices/${dev.device_id}/commands`, { method: "POST", token: admin, body: { type: "ring" } });
  assert.equal((await call("/agent/ping", { method: "POST", token: dev.device_token })).data.pending, 1);
  // Sans code de l'administrateur : refusé
  assert.equal((await call("/agent/unenroll", { method: "POST", token: dev.device_token })).status, 403);
  assert.equal((await call("/agent/unenroll", { method: "POST", token: dev.device_token, body: { unlock_code: "00000000" } })).status, 403);
  // Code demandé par un utilisateur : refusé ; sans motif : refusé
  assert.equal((await call(`/api/devices/${dev.device_id}/unlock-code`, { method: "POST", token: claire, body: { reason: "x" } })).status, 403);
  assert.equal((await call(`/api/devices/${dev.device_id}/unlock-code`, { method: "POST", token: admin, body: {} })).status, 422);
  const { data: unlock } = await call(`/api/devices/${dev.device_id}/unlock-code`, { method: "POST", token: admin, body: { reason: "Départ du salarié" } });
  assert.match(unlock.code, /^\d{8}$/);
  // Protection désactivée sur le téléphone → alerte critique
  await call("/agent/checkin", { method: "POST", token: dev.device_token, body: { inventory: { admin_active: false } } });
  const alerts = (await call("/api/alerts", { token: admin })).data;
  assert.ok(JSON.stringify(alerts).includes("protection de l'agent MDM"));
  assert.equal((await call("/agent/unenroll", { method: "POST", token: dev.device_token, body: { unlock_code: unlock.code } })).status, 200);
  assert.equal((await call("/agent/checkin", { method: "POST", token: dev.device_token, body: {} })).status, 401);
  const { data: d } = await call(`/api/devices/${dev.device_id}`, { token: admin });
  assert.ok(d.status === "retiré" || d.error);
});
