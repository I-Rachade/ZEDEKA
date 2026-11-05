// Revue du design de toutes les applis (client, livreur, restaurant, marchand, admin, site), connectées :
// mêmes règles que audit-apple.cjs. Les sessions sont créées par l'API de test (codes SMS affichés, mot de passe
// admin de env.mjs, accès démo du restaurant « chez-tante-ama »), puis posées sur l'appareil comme après connexion.
//   node e2e/scripts/audit-apple-all.cjs        (site et API lancés comme pour les tests, ports 3100 et 8788)
//   COLOR=dark node e2e/scripts/audit-apple-all.cjs   même revue en mode sombre
// Résultat dans OUT (par défaut ./audit-apple) : une capture par page et report.json. Code de sortie 1 s'il reste
// une cible tactile de moins de 44 px.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const WEB = process.env.BASE || "http://localhost:3100";
const API = process.env.API || "http://localhost:8788/api";
const OUT = process.env.OUT || path.join(process.cwd(), "audit-apple");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "e2e-directeur-mot-de-passe";

const ROUTES = {
  site: "/ /colis /suivi /conditions /confidentialite /cookies /mentions-legales /remboursement /suppression-donnees /hors-ligne /r/chez-tante-ama /livreur/connexion /livreur/candidature /restaurant/connexion /restaurant/mot-de-passe /admin/connexion /marchand/connexion",
  client: "/app /app/recherche /app/commandes /app/adresses /app/profil /app/profil/economie /app/aide /app/annulation /app/zed",
  livreur: "/livreur /livreur/gains /livreur/especes /livreur/profil /livreur/zed",
  restaurant: "/restaurant /restaurant/commandes /restaurant/caisse /restaurant/carte /restaurant/tables /restaurant/equipe /restaurant/reglages /restaurant/releves /restaurant/compte",
  marchand: "/marchand /marchand/envoyer /marchand/colis /marchand/argent /marchand/boutique",
  admin: "/admin /admin/commandes /admin/dispatch /admin/colis /admin/restaurants /admin/livreurs /admin/marchands /admin/candidatures /admin/demandes /admin/partenaires /admin/zones /admin/promotions /admin/publicites /admin/finances /admin/rapport /admin/equipe /admin/reglages /admin/sante /admin/zed",
};

let n = 0;
const ip = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function call(method, p, body, token) {
  const res = await fetch(API + p, {
    method,
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
  return res.json();
}
const phone = () => `9${String(Date.now() + n++).slice(-7)}`;

async function sessions() {
  const s = {};
  const admin = (await call("POST", "/admin/login", { password: ADMIN_PASSWORD })).token;
  s.admin = { "zedeka-admin-token": admin };
  const cp = phone();
  const { devCode } = await call("POST", "/customer/otp/request", { phone: cp });
  const c = await call("POST", "/customer/otp/verify", { phone: cp, code: devCode, name: "Ama Kpodar", acceptTerms: true });
  const customer = JSON.stringify({ token: c.token, ...c.customer, hasPin: true });
  s.client = { "zedeka.customer": customer };
  await call("POST", "/marchand/me", { name: "Ama Fashion", address: "Tokoin Wuiti", acceptTerms: true }, c.token).catch(() => {});
  s.marchand = { "zedeka.customer": customer };
  const r = await call("POST", "/restaurant/login", { email: "chez-tante-ama@demo.zedeka.tg", password: "zedeka-demo" });
  s.restaurant = { "zedeka-restaurant-token": r.token, "zedeka-restaurant-name": r.restaurant?.name ?? "Chez Tante Ama", "zedeka-restaurant-role": r.role ?? "OWNER" };
  const zones = await call("GET", "/admin/zones", null, admin);
  const dp = phone();
  await call("POST", "/admin/drivers", { name: "Kodjo Audit", phone: `+228${dp}`, zoneId: zones[0].id, online: false, employment: "FREELANCE", pin: "2580" }, admin);
  const otp = await call("POST", "/livreur/otp/request", { phone: dp });
  const d = await call("POST", "/livreur/otp/verify", { phone: dp, code: otp.devCode });
  s.livreur = { "zedeka.driver": JSON.stringify({ token: d.token, name: "Kodjo Audit", phone: dp }) };
  s.site = {};
  return s;
}

function check() {
  const vis = (e) => { const s = getComputedStyle(e); const rc = e.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && rc.width > 0 && rc.height > 0; };
  const small = [];
  document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],summary").forEach((e) => {
    if (!vis(e)) return;
    const r0 = e.getBoundingClientRect();
    if (e.classList.contains("sr-only") || r0.width <= 1) return;
    if (e.tagName === "A" && getComputedStyle(e).display === "inline") return; // lien dans un texte
    if (e.tagName === "INPUT" && /checkbox|radio/.test(e.type) && e.closest("label")) return; // le libellé porte le toucher
    if (e.closest(".leaflet-container")) return; // commandes de la carte
    // Zone tactile élargie en invisible (classe « hit » ou règle globale au doigt) : pseudo-élément absolu.
    const rc = { width: r0.width, height: r0.height };
    for (const ps of ["::before", "::after"]) {
      const a = getComputedStyle(e, ps);
      if (a.content === "none" || a.position !== "absolute") continue;
      rc.width = Math.max(rc.width, parseFloat(a.width) || 0);
      rc.height = Math.max(rc.height, parseFloat(a.height) || 0);
    }
    if (rc.height < 43.5 || rc.width < 43.5) {
      small.push({ tag: e.tagName.toLowerCase(), w: Math.round(rc.width), h: Math.round(rc.height), cls: (e.getAttribute("class") || "").slice(0, 90), text: (e.getAttribute("aria-label") || e.innerText || e.value || "").trim().slice(0, 40) });
      e.style.outline = "2px dashed #e0503a";
    }
  });
  let tiny = 0;
  const offgrid = new Set();
  document.querySelectorAll("body *").forEach((e) => {
    if (!vis(e)) return;
    const s = getComputedStyle(e);
    if ([...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim()) && parseFloat(s.fontSize) < 11) tiny++;
    for (const k of ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "marginTop", "marginBottom", "rowGap", "columnGap"]) {
      const v = parseFloat(s[k]);
      if (v > 0 && v % 4 !== 0) offgrid.add(v);
    }
  });
  return { small, tiny, offgrid: [...offgrid].sort((a, b) => a - b) };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const s = await sessions();
  const b = await chromium.launch();
  const report = {};
  let total = 0;
  for (const [app, list] of Object.entries(ROUTES)) {
    const ctx = await b.newContext({ ...devices["iPhone 13"], locale: "fr-FR", colorScheme: process.env.COLOR === "dark" ? "dark" : "light", extraHTTPHeaders: { "cf-connecting-ip": ip } });
    await ctx.addInitScript((kv) => { localStorage.setItem("zedeka.cookieNotice", "true"); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, s[app]);
    for (const p of list.split(" ")) {
      const page = await ctx.newPage();
      await page.goto(WEB + p, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const r = await page.evaluate(check);
      await page.screenshot({ path: path.join(OUT, `${app}${p.replace(/\//g, "_")}.png`), fullPage: true });
      report[`${app} ${p}`] = { url: page.url().replace(WEB, ""), ...r };
      total += r.small.length;
      console.log(`${app.padEnd(10)} ${p.padEnd(28)} cibles<44: ${String(r.small.length).padStart(2)}  texte<11px: ${r.tiny}  hors grille: ${r.offgrid.join(" ")}`);
      await page.close();
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`Total des cibles de moins de 44 px : ${total}`);
  await b.close();
  process.exit(total ? 1 : 0);
})();
