// Revue du design selon les règles d'Apple (skill .claude/skills/apple-hig-designer), sur les pages réelles en format
// téléphone : cibles tactiles de moins de 44 px (la zone élargie par la classe « hit » compte), texte de moins de 11 px,
// espacements qui ne sont pas des multiples de 4 px. Site et API lancés comme pour les tests (ports 3100 et 8788).
//   node e2e/scripts/audit-apple.cjs                      pages par défaut
//   PAGES=/app,/colis OUT=/tmp/audit node e2e/scripts/audit-apple.cjs
// Résultat : une capture par page (cibles trop petites cerclées de rouge) et report.json dans OUT.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:3100";
const OUT = process.env.OUT || require("path").join(process.cwd(), "audit-apple");
const pages = (process.env.PAGES || "/,/app,/app/recherche,/r/chez-tante-ama,/app/profil,/app/connexion,/colis,/livreur,/restaurant").split(",");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices["iPhone 13"], locale: "fr-FR" });
  const report = {};
  for (const p of pages) {
    const page = await ctx.newPage();
    await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const vis = (e) => { const s = getComputedStyle(e); const rc = e.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && rc.width > 0 && rc.height > 0; };
      const small = [];
      document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=button],summary").forEach((e) => {
        if (!vis(e)) return;
        const r0 = e.getBoundingClientRect();
        const a = getComputedStyle(e, "::after");
        const rc = a.content !== "none" && a.position === "absolute" ? { width: Math.max(r0.width, parseFloat(a.width) || 0), height: Math.max(r0.height, parseFloat(a.height) || 0) } : r0;
        if (e.classList.contains("sr-only") || r0.width <= 1) return;
        // Un lien dans un paragraphe de texte est exempté (HIG : cible inline).
        if (e.tagName === "A" && getComputedStyle(e).display === "inline") return;
        if (rc.height < 44 || rc.width < 44) {
          small.push({ tag: e.tagName.toLowerCase(), w: Math.round(rc.width), h: Math.round(rc.height), text: (e.getAttribute("aria-label") || e.innerText || e.value || "").trim().slice(0, 40) });
          e.style.outline = "2px dashed #e0503a"; e.style.outlineOffset = "0px";
        }
      });
      let tiny = 0, texts = 0;
      const offgrid = new Set();
      document.querySelectorAll("body *").forEach((e) => {
        if (!vis(e)) return;
        const s = getComputedStyle(e);
        if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
          texts++;
          if (parseFloat(s.fontSize) < 11) tiny++;
        }
        for (const k of ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "marginTop", "marginBottom", "rowGap", "columnGap"]) {
          const v = parseFloat(s[k]);
          if (v > 0 && v % 4 !== 0) offgrid.add(v);
        }
      });
      return { small, tiny, texts, offgrid: [...offgrid].sort((a, b) => a - b) };
    });
    const name = p.replace(/\//g, "_") || "_root";
    await page.screenshot({ path: `${OUT}/${name}.png` });
    report[p] = { smallCount: r.small.length, small: r.small.slice(0, 30), tinyText: r.tiny, texts: r.texts, offgrid: r.offgrid };
    console.log(p, "petites cibles:", r.small.length, "texte<11px:", r.tiny, "/", r.texts, "hors grille:", r.offgrid.join(" "));
    await page.close();
  }
  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await b.close();
})();
