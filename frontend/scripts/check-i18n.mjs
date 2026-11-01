// Vérifie les traductions anglaises (src/lib/i18n/en/*.ts) : chaque phrase passée à t("…") ou tr("…") doit y être,
// et les textes français restés hors du dictionnaire sont listés. `npm run i18n` ; sortie en erreur s'il en manque.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const dictDir = join(root, "lib/i18n/en");

const keys = new Set();
for (const f of readdirSync(dictDir)) {
  const src = readFileSync(join(dictDir, f), "utf8");
  for (const m of src.matchAll(/^ {2}("(?:[^"\\]|\\.)*"):/gm)) keys.add(JSON.parse(m[1]));
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (p !== join(root, "lib/i18n")) walk(p);
    } else if (/\.(tsx?|mjs)$/.test(name)) files.push(p);
  }
})(root);

// Un texte « français » : au moins un mot de 2 lettres minuscules, ou une lettre accentuée, et pas une classe CSS.
const looksFrench = (s) =>
  /[a-zà-ÿ]{2}/.test(s) &&
  (/[éèêàâùûôîçœ]/i.test(s) || / [a-zà-ÿ]/.test(s) || /^[A-ZÀ-Ý][a-zà-ÿ]+$/.test(s)) &&
  !/^(https?:|\/|@|#|\.\/|[a-z-]+\/)/.test(s) &&
  !/\b(flex|grid|text-|bg-|px-|py-|rounded|border|w-|h-|gap-|font-|items-|justify-|space-|shadow|hidden|inline|block|mt-|mb-|ml-|mr-|p-|m-|top-|left-|right-|bottom-|z-|min-|max-|absolute|relative|fixed|sticky|overflow|cursor|transition|ring|opacity|tabular|uppercase|tracking|leading|truncate|whitespace|underline|shrink|grow|sr-only|object-|select-|pointer|aspect|divide|translate|scale|rotate|backdrop|animate|anim-|hairline|skeleton|glass|print:|sm:|md:|lg:)/.test(s);

// Textes qui restent tels quels dans les deux langues (noms propres, unités, codes).
const KEEP = new Set(["use client", "Promise", "Escape", "Notification", "Zedeka", "WhatsApp", "FCFA", "T-Money", "Flooz", "Google Maps", "OpenStreetMap", "Lomé", "Togo", "Logo", "Latitude", "Longitude", "Organization", "City", "{x} min", " · {x} kg", "{x} km", "{x})} km", "Enter", ", {x} kg", "(display-mode: standalone)", ": done ?", "API {x} sur {x}", ") | null, deps: unknown[]): Loadable", "conic-gradient(rgb(5 150 105) {x}%, rgb(231 229 228) 0)"]);

const missing = new Map();
const untranslated = new Map();
const add = (map, key, where) => map.set(key, [...(map.get(key) ?? []), where]);

for (const file of files) {
  const rel = relative(root, file);
  const src = readFileSync(file, "utf8")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (m, p) => p + " ".repeat(m.length - p.length));
  const line = (i) => src.slice(0, i).split("\n").length;
  const lines = readFileSync(file, "utf8").split("\n");
  for (const m of src.matchAll(/\btr?\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    const key = JSON.parse(`"${m[1]}"`);
    if (!keys.has(key)) add(missing, key, `${rel}:${line(m.index)}`);
  }
  // Fichier rédigé dans chaque langue (textes juridiques) : seuls ses appels à t() sont vérifiés.
  if (lines.some((l) => l.includes("i18n-ignore-file"))) continue;
  // Texte JSX (pas les types génériques : ni ; ni = ni guillemets) et attributs affichés tels quels :
  // à traduire même si la phrase est au dictionnaire.
  const raw = [
    ...[...src.matchAll(/\b(?:aria-label|placeholder|alt)="([^"]*)"/g)].map((m) => [m[1], m.index]),
    ...[...src.matchAll(/>([^<>{}=;"`]*[A-Za-zÀ-ÿ][^<>{}=;"`]*)</g)].filter((m) => !/&&|\|\||^\s*\(|\)\s*$/.test(m[1])).map((m) => [m[1].trim(), m.index]),
  ];
  for (const [s, i] of raw) if (s && !KEEP.has(s) && looksFrench(s) && !/i18n-ignore/.test(lines[line(i) - 1] ?? "")) add(untranslated, s, `${rel}:${line(i)}`);
  const literals = [
    ...[...src.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => [m[1], m.index]),
    ...[...src.matchAll(/`((?:[^`\\]|\\.)*)`/g)].filter((m) => !/\btr?\(/.test(m[1])).map((m) => [m[1].replace(/\$\{[^}]*\}/g, "{x}"), m.index]),
  ];
  for (const [raw, i] of literals) {
    const s = raw.replace(/&apos;/g, "'").replace(/&quot;/g, '"');
    if (!s || KEEP.has(s) || keys.has(s) || !looksFrench(s)) continue;
    const before = src.slice(Math.max(0, i - 40), i);
    if (/(className|import|from|require|key|href|src|type|name|role|inputMode|autoComplete|pattern|method|mode|id|lang|rel|target|value)=?\s*\{?\s*$/.test(before)) continue;
    if (/(from|import)\s*$/.test(before) || /console\.\w+\(\s*$/.test(before)) continue;
    // « i18n-ignore » en commentaire sur la ligne : texte technique, laissé tel quel.
    if (/i18n-ignore/.test(lines[line(i) - 1] ?? "")) continue;
    add(untranslated, s, `${rel}:${line(i)}`);
  }
}

for (const [k, w] of missing) console.log(`MANQUANT  ${JSON.stringify(k)}  (${w.join(", ")})`);
for (const [k, w] of untranslated) console.log(`À VÉRIFIER  ${JSON.stringify(k)}  (${w.join(", ")})`);
console.log(`\n${keys.size} phrases traduites, ${missing.size} manquantes, ${untranslated.size} textes à vérifier.`);
if (missing.size) process.exit(1);
