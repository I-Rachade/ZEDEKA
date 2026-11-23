import type { PrismaClient } from "@prisma/client";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "./migrationList.js";
import type { Notifier } from "./notify.js";

// Bilan quotidien de sécurité et d'état (écran technique, Admin > Bilan du jour), chaque jour à 6 h (heure de Lomé, UTC).
// Deux moitiés :
// - le code, contrôlé par GitHub Actions (workflow « Bilan quotidien ») : dépendances vulnérables (npm audit), secrets
//   (Gitleaks), failles du code (Semgrep), tests et types, certificat HTTPS. Le rapport est publié sur la branche
//   « bilan » du dépôt (public) et relu ici, sans aucun secret ;
// - l'appli en ligne, contrôlée par le Worker lui-même : en-têtes de sécurité, routes essentielles, routes protégées,
//   CORS, messages d'erreur, gros envois, limites de tentatives, migrations, base de données, clés d'écran dormantes.
// Aucune donnée personnelle : seulement des codes de réponse, des noms de routes et des nombres.

export type CheckStatus = "ok" | "warn" | "fail" | "skip";
export type Severity = "critical" | "high" | "moderate" | "low";
export type Check = { key: string; label: string; status: CheckStatus; note: string; severity?: Severity; group: "api" | "code" | "app" };
export type Counts = Record<Severity, number>;

// Rapport du workflow GitHub (fichier bilan.json de la branche « bilan »).
export type CiReport = {
  generatedAt: string;
  commit?: string;
  npmAudit?: { critical: number; high: number; moderate: number; low: number; packages?: { name: string; severity: string; dir: string }[] };
  secrets?: { findings: number };
  semgrep?: { error: number; warning: number; top?: { rule: string; file: string }[] };
  tests?: { ok: boolean; note?: string };
  tls?: { daysLeft: number | null; protocol: string | null };
};

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type AuditConfig = {
  // Adresse publique du site (les routes /api y passent) : https://zedeka.poinderecharge.com
  origin: string;
  fetcher?: Fetcher;
  // Rapport du dépôt : https://raw.githubusercontent.com/<dépôt>/bilan/bilan.json
  ciReportUrl?: string;
  // Limites de tentatives branchées (liaisons Rate Limiting du Worker).
  limiters: Record<string, boolean>;
  now?: () => Date;
};

const TIMEOUT_MS = 8_000;
const SLOW_MS = 3_000;
const DAY_MS = 86_400_000;

const REQUIRED_HEADERS: [header: string, label: string][] = [
  ["strict-transport-security", "HSTS"],
  ["content-security-policy", "CSP"],
  ["x-frame-options", "X-Frame-Options"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "Referrer-Policy"],
  ["permissions-policy", "Permissions-Policy"],
];
// Routes publiques qui doivent répondre vite (lecture seule, sans compte).
export const ESSENTIAL_ROUTES = ["/api/health", "/api/zones", "/api/restaurants", "/api/policies", "/api/parcel-categories", "/api/promos"];
// Routes des espaces connectés : sans connexion, elles doivent refuser (401 ou 403).
export const PROTECTED_ROUTES = ["/api/admin/me", "/api/admin/orders", "/api/restaurant/me", "/api/livreur/me", "/api/marchand/me", "/api/customer/me", "/api/screen/tech"];

async function timed(fetcher: Fetcher, url: string, init: RequestInit = {}): Promise<{ res: Response | null; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const res = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { res, ms: Date.now() - t0 };
  } catch (e) {
    return { res: null, ms: Date.now() - t0, error: e instanceof Error ? e.name : "échec" };
  }
}

const check = (key: string, label: string, group: Check["group"], status: CheckStatus, note: string, severity?: Severity): Check => ({
  key,
  label,
  group,
  status,
  note,
  ...(status === "ok" || status === "skip" ? {} : severity ? { severity } : {}),
});

// ---- Contrôles de l'appli en ligne ------------------------------------------------------------------------------

export async function liveChecks(prisma: PrismaClient, config: AuditConfig): Promise<Check[]> {
  const fetcher = config.fetcher ?? fetch;
  const base = config.origin.replace(/\/$/, "");
  const checks: Check[] = [];

  // En-têtes de sécurité : page d'accueil du site et une réponse de l'API.
  const [home, api] = await Promise.all([timed(fetcher, `${base}/`), timed(fetcher, `${base}/api/health`)]);
  if (!home.res) checks.push(check("headers", "En-têtes de sécurité", "app", "fail", "site injoignable", "critical"));
  else {
    const missing = REQUIRED_HEADERS.filter(([h]) => !home.res!.headers.get(h)).map(([, l]) => l);
    const apiMissing = api.res && !api.res.headers.get("x-content-type-options") ? ["nosniff (API)"] : [];
    const all = [...missing, ...apiMissing];
    checks.push(
      all.length
        ? check("headers", "En-têtes de sécurité", "app", "fail", `manque : ${all.join(", ")}`, "moderate")
        : check("headers", "En-têtes de sécurité", "app", "ok", `${REQUIRED_HEADERS.length} sur ${REQUIRED_HEADERS.length}`),
    );
  }

  // Routes essentielles : réponse correcte et en moins de 3 s.
  const essentials = await Promise.all(ESSENTIAL_ROUTES.map(async (path) => ({ path, ...(await timed(fetcher, `${base}${path}`)) })));
  const broken = essentials.filter((e) => !e.res || e.res.status >= 400);
  const slow = essentials.filter((e) => e.res && e.res.status < 400 && e.ms > SLOW_MS);
  checks.push(
    broken.length
      ? check("endpoints", "Routes essentielles de l'API", "api", "fail", `en panne : ${broken.map((b) => `${b.path} (${b.res?.status ?? b.error})`).join(", ")}`, "high")
      : slow.length
        ? check("endpoints", "Routes essentielles de l'API", "api", "warn", `lentes : ${slow.map((s) => `${s.path} ${(s.ms / 1000).toFixed(1)} s`).join(", ")}`, "moderate")
        : check("endpoints", "Routes essentielles de l'API", "api", "ok", `${essentials.length} sur ${essentials.length}`),
  );

  // Espaces connectés fermés sans connexion.
  const guarded = await Promise.all(PROTECTED_ROUTES.map(async (path) => ({ path, ...(await timed(fetcher, `${base}${path}`)) })));
  const open = guarded.filter((g) => g.res && g.res.status >= 200 && g.res.status < 300);
  const unknown = guarded.filter((g) => !g.res);
  checks.push(
    open.length
      ? check("protected", "Routes protégées", "api", "fail", `ouvertes sans connexion : ${open.map((o) => o.path).join(", ")}`, "critical")
      : unknown.length
        ? check("protected", "Routes protégées", "api", "warn", `sans réponse : ${unknown.map((u) => u.path).join(", ")}`, "low")
        : check("protected", "Routes protégées", "api", "ok", `${guarded.length} fermées`),
  );

  // CORS : un autre site ne doit pas pouvoir lire les réponses de l'API.
  const cors = await timed(fetcher, `${base}/api/zones`, { headers: { Origin: "https://site-inconnu.example" } });
  const allowed = cors.res?.headers.get("access-control-allow-origin") ?? null;
  checks.push(
    !cors.res
      ? check("cors", "CORS limité au site", "api", "skip", "pas de réponse")
      : allowed === "*" || allowed === "https://site-inconnu.example"
        ? check("cors", "CORS limité au site", "api", "fail", `ouvert à ${allowed}`, "high")
        : check("cors", "CORS limité au site", "api", "ok", "réservé au site Zedeka"),
  );

  // Message d'erreur sans détail technique (corps JSON cassé).
  const broken400 = await timed(fetcher, `${base}/api/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" });
  const body = broken400.res ? await broken400.res.text().catch(() => "") : "";
  const leaks = /\bat\s+\S+\s*\(|node_modules|SyntaxError|Prisma|D1_ERROR|\.ts:\d+/.test(body);
  checks.push(
    !broken400.res
      ? check("leak", "Messages d'erreur sans détail technique", "api", "skip", "pas de réponse")
      : leaks
        ? check("leak", "Messages d'erreur sans détail technique", "api", "fail", "la réponse montre du code ou une trace", "moderate")
        : broken400.res.status >= 500
          ? check("leak", "Messages d'erreur sans détail technique", "api", "warn", `envoi invalide répondu ${broken400.res.status} au lieu de 400`, "low")
          : check("leak", "Messages d'erreur sans détail technique", "api", "ok", "aucune trace"),
  );

  // Gros envois refusés (au-delà de 100 ko sur les routes publiques).
  const big = await timed(fetcher, `${base}/api/track`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: "a".repeat(300_000) }) });
  checks.push(
    !big.res
      ? check("bigBody", "Gros envois refusés", "api", "skip", "pas de réponse")
      : big.res.status === 413
        ? check("bigBody", "Gros envois refusés", "api", "ok", "300 ko refusés (413)")
        : check("bigBody", "Gros envois refusés", "api", "warn", `300 ko répondus ${big.res.status}`, "moderate"),
  );

  // Limites de tentatives (connexion, codes SMS, formulaires) branchées sur le Worker.
  const missingLimits = Object.entries(config.limiters)
    .filter(([, on]) => !on)
    .map(([name]) => name);
  checks.push(
    missingLimits.length
      ? check("rateLimits", "Limites de tentatives", "api", "fail", `absentes : ${missingLimits.join(", ")}`, "high")
      : check("rateLimits", "Limites de tentatives", "api", "ok", `${Object.keys(config.limiters).length} actives`),
  );

  // Migrations : toutes celles livrées avec ce code sont-elles appliquées en ligne ?
  try {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM d1_migrations`);
    const names = new Set(rows.map((r) => r.name));
    checks.push(
      names.has(LATEST_MIGRATION) && names.size >= MIGRATION_COUNT
        ? check("migrations", "Migrations de la base", "app", "ok", `à jour (${LATEST_MIGRATION.slice(0, 4)})`)
        : check("migrations", "Migrations de la base", "app", "fail", `manque ${names.has(LATEST_MIGRATION) ? "au moins une" : LATEST_MIGRATION}`, "high"),
    );
  } catch {
    checks.push(check("migrations", "Migrations de la base", "app", "skip", "liste illisible"));
  }

  // Base de données : temps d'une lecture simple.
  const t0 = Date.now();
  const dbOk = await prisma.$queryRawUnsafe("SELECT 1").then(
    () => true,
    () => false,
  );
  const dbMs = Date.now() - t0;
  checks.push(
    !dbOk
      ? check("database", "Base de données", "app", "fail", "ne répond pas", "critical")
      : dbMs > 1500
        ? check("database", "Base de données", "app", "warn", `lente (${dbMs} ms)`, "moderate")
        : check("database", "Base de données", "app", "ok", `${dbMs} ms`),
  );

  // Clés d'écran branchées mais plus utilisées depuis 30 jours : à débrancher.
  const now = (config.now ?? (() => new Date()))();
  const dormant = await prisma.displayScreen
    .count({ where: { revokedAt: null, OR: [{ lastSeenAt: null, createdAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } }, { lastSeenAt: { lt: new Date(now.getTime() - 30 * DAY_MS) } }] } })
    .catch(() => 0);
  checks.push(dormant ? check("screens", "Clés d'écran dormantes", "app", "warn", `${dormant} à débrancher`, "low") : check("screens", "Clés d'écran dormantes", "app", "ok", "aucune"));

  return checks;
}

// ---- Rapport du dépôt (GitHub Actions) -------------------------------------------------------------------------

export async function readCiReport(config: AuditConfig): Promise<CiReport | null> {
  if (!config.ciReportUrl) return null;
  const r = await timed(config.fetcher ?? fetch, config.ciReportUrl, { headers: { "Cache-Control": "no-cache" } });
  if (!r.res || !r.res.ok) return null;
  try {
    const data = (await r.res.json()) as CiReport;
    return typeof data?.generatedAt === "string" ? data : null;
  } catch {
    return null;
  }
}

export function ciChecks(report: CiReport | null, now: Date): Check[] {
  const age = report ? now.getTime() - Date.parse(report.generatedAt) : Infinity;
  if (!report || !(age < 36 * 3_600_000)) {
    return [check("ci", "Rapport du dépôt (code)", "code", "warn", report ? "rapport de plus de 36 h" : "rapport absent", "low")];
  }
  const out: Check[] = [];
  const a = report.npmAudit;
  out.push(
    !a
      ? check("deps", "Dépendances", "code", "skip", "non contrôlées")
      : a.critical
        ? check("deps", "Dépendances", "code", "fail", `${a.critical} critique(s), ${a.high} haute(s)`, "critical")
        : a.high
          ? check("deps", "Dépendances", "code", "warn", `${a.high} haute(s), ${a.moderate} moyenne(s)`, "high")
          : a.moderate
            ? check("deps", "Dépendances", "code", "ok", `${a.moderate} moyenne(s)`)
            : check("deps", "Dépendances", "code", "ok", "aucune faille connue"),
  );
  const s = report.secrets;
  out.push(!s ? check("secrets", "Secrets dans le code", "code", "skip", "non contrôlés") : s.findings ? check("secrets", "Secrets dans le code", "code", "fail", `${s.findings} trouvé(s)`, "critical") : check("secrets", "Secrets dans le code", "code", "ok", "aucun"));
  const g = report.semgrep;
  out.push(
    !g
      ? check("code", "Failles du code", "code", "skip", "non contrôlées")
      : g.error
        ? check("code", "Failles du code", "code", "fail", `${g.error} grave(s)`, "high")
        : g.warning
          ? check("code", "Failles du code", "code", "warn", `${g.warning} à regarder`, "moderate")
          : check("code", "Failles du code", "code", "ok", "aucune"),
  );
  const t = report.tests;
  out.push(!t ? check("tests", "Tests et types", "code", "skip", "non lancés") : t.ok ? check("tests", "Tests et types", "code", "ok", t.note ?? "réussis") : check("tests", "Tests et types", "code", "fail", t.note ?? "en échec", "high"));
  const tls = report.tls;
  out.push(
    !tls || tls.daysLeft === null
      ? check("tls", "Certificat HTTPS", "app", "skip", "non lu")
      : tls.daysLeft < 7
        ? check("tls", "Certificat HTTPS", "app", "fail", `expire dans ${tls.daysLeft} j`, "critical")
        : tls.daysLeft < 14 || (tls.protocol && /TLSv1(\.[01])?$/.test(tls.protocol))
          ? check("tls", "Certificat HTTPS", "app", "warn", `expire dans ${tls.daysLeft} j${tls.protocol ? `, ${tls.protocol}` : ""}`, "high")
          : check("tls", "Certificat HTTPS", "app", "ok", `expire dans ${tls.daysLeft} j`),
  );
  return out;
}

// Failles par gravité : celles des dépendances (npm audit) plus chaque contrôle en échec ou à surveiller.
export function countFindings(checks: Check[], report: CiReport | null): Counts {
  const counts: Counts = { critical: 0, high: 0, moderate: 0, low: 0 };
  const fresh = report && Date.now() - Date.parse(report.generatedAt) < 36 * 3_600_000;
  if (fresh && report?.npmAudit) {
    counts.critical += report.npmAudit.critical;
    counts.high += report.npmAudit.high;
    counts.moderate += report.npmAudit.moderate;
    counts.low += report.npmAudit.low;
  }
  for (const c of checks) if (c.severity && c.key !== "deps") counts[c.severity]++;
  return counts;
}

// ---- Bilan complet ---------------------------------------------------------------------------------------------

export type AuditResult = { day: string; ranAt: string; durationSec: number; counts: Counts; checks: Check[]; ci: CiReport | null };

export async function runAudit(prisma: PrismaClient, config: AuditConfig): Promise<AuditResult> {
  const started = (config.now ?? (() => new Date()))();
  const [live, ci] = await Promise.all([liveChecks(prisma, config), readCiReport(config)]);
  const checks = [...ciChecks(ci, started), ...live];
  const counts = countFindings(checks, ci);
  const durationSec = Math.max(0, Math.round((Date.now() - started.getTime()) / 1000));
  const day = started.toISOString().slice(0, 10);
  const data = {
    ranAt: started,
    durationSec,
    critical: counts.critical,
    high: counts.high,
    moderate: counts.moderate,
    low: counts.low,
    checks: JSON.stringify(checks),
    ci: ci ? JSON.stringify(ci) : null,
  };
  await prisma.securityAudit.upsert({ where: { day }, create: { day, ...data }, update: data });
  return { day, ranAt: started.toISOString(), durationSec, counts, checks, ci };
}

// Alerte au directeur et à l'adjoint (catégorie TECH, réglable par chacun dans ses notifications) : faille critique,
// ou haute, au plus une fois toutes les 12 h pour un même titre.
export async function alertAudit(prisma: PrismaClient, notifier: Notifier, result: AuditResult, now = new Date()): Promise<string | null> {
  const failing = result.checks.filter((c) => c.severity === "critical" || c.severity === "high");
  if (!result.counts.critical && !result.counts.high) return null;
  const title = result.counts.critical ? "Bilan de sécurité : faille critique" : "Bilan de sécurité : faille à corriger";
  const recent = await prisma.staffNotification.findFirst({ where: { category: "TECH", title, createdAt: { gte: new Date(now.getTime() - 12 * 3_600_000) } }, select: { id: true } });
  if (recent) return null;
  const body = failing.length ? failing.map((c) => `${c.label} : ${c.note}`).join(" · ").slice(0, 300) : `${result.counts.critical} critique(s), ${result.counts.high} haute(s).`;
  await notifier.staff("TECH", { title, body, url: "/admin/bilan", tag: `audit-${result.day}`, alarm: result.counts.critical > 0 });
  return title;
}

// Dernier bilan pour l'écran technique et l'admin.
export function auditView(row: { day: string; ranAt: Date; durationSec: number | null; critical: number; high: number; moderate: number; low: number; checks: string; ci?: string | null }) {
  let checks: Check[] = [];
  try {
    checks = JSON.parse(row.checks) as Check[];
  } catch {
    checks = [];
  }
  let ci: CiReport | null = null;
  try {
    ci = row.ci ? (JSON.parse(row.ci) as CiReport) : null;
  } catch {
    ci = null;
  }
  return {
    day: row.day,
    ranAt: row.ranAt.toISOString(),
    durationSec: row.durationSec,
    counts: { critical: row.critical, high: row.high, moderate: row.moderate, low: row.low },
    checks,
    ci,
  };
}
