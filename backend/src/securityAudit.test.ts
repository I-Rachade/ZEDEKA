import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "./migrationList.js";
import { alertAudit, ciChecks, countFindings, ESSENTIAL_ROUTES, liveChecks, PROTECTED_ROUTES, runAudit, type AuditConfig, type CiReport, type Fetcher } from "./securityAudit.js";

const ORIGIN = "https://zedeka.test";
const GOOD_HEADERS = {
  "strict-transport-security": "max-age=31536000",
  "content-security-policy": "default-src 'self'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=()",
};

type Override = (path: string, init?: RequestInit) => Response | undefined;

// Site sain : en-têtes en place, routes publiques en 200, routes protégées en 401, CORS fermé, erreurs propres.
function site(override: Override = () => undefined): Fetcher {
  return async (url, init) => {
    const path = url.replace(ORIGIN, "");
    const custom = override(path, init);
    if (custom) return custom;
    if (path === "/") return new Response("<html>", { headers: GOOD_HEADERS });
    if (PROTECTED_ROUTES.includes(path)) return new Response("{}", { status: 401 });
    if (path === "/api/track") {
      const body = String(init?.body ?? "");
      return body.length > 100_000 ? new Response('{"error":"Envoi trop volumineux"}', { status: 413 }) : new Response('{"error":"Requête invalide"}', { status: 400 });
    }
    return new Response("[]", { headers: { "x-content-type-options": "nosniff" } });
  };
}

function db(migrations = Array.from({ length: MIGRATION_COUNT - 1 }, (_, i) => ({ name: `m${i}` })).concat({ name: LATEST_MIGRATION })) {
  const saved: unknown[] = [];
  const prisma = {
    $queryRawUnsafe: async (sql: string) => (sql.includes("d1_migrations") ? migrations : [{ 1: 1 }]),
    displayScreen: { count: async () => 0 },
    securityAudit: { upsert: async (a: unknown) => saved.push(a) },
  } as unknown as PrismaClient;
  return { prisma, saved };
}

const config = (fetcher: Fetcher, extra: Partial<AuditConfig> = {}): AuditConfig => ({ origin: ORIGIN, fetcher, limiters: { connexion: true, "codes SMS": true }, ...extra });

describe("bilan quotidien : appli en ligne", () => {
  it("tout est vert sur un site sain", async () => {
    const checks = await liveChecks(db().prisma, config(site()));
    expect(checks.filter((c) => c.status !== "ok").map((c) => [c.key, c.note])).toEqual([]);
    expect(checks.map((c) => c.key)).toEqual(["headers", "endpoints", "protected", "cors", "leak", "bigBody", "rateLimits", "migrations", "database", "screens"]);
  });

  it("signale en-tête manquant, route en panne, route ouverte et CORS ouvert", async () => {
    const fetcher = site((path, init) => {
      if (path === "/") return new Response("<html>", { headers: { ...GOOD_HEADERS, "content-security-policy": "" } });
      if (path === ESSENTIAL_ROUTES[2]) return new Response("{}", { status: 500 });
      if (path === "/api/livreur/me") return new Response("{}", { status: 200 });
      if (path === "/api/zones" && (init?.headers as Record<string, string> | undefined)?.Origin) return new Response("[]", { headers: { "access-control-allow-origin": "*" } });
      return undefined;
    });
    const checks = await liveChecks(db().prisma, config(fetcher));
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    expect(by.headers).toMatchObject({ status: "fail", severity: "moderate", note: "manque : CSP" });
    expect(by.endpoints).toMatchObject({ status: "fail", severity: "high" });
    expect(by.endpoints.note).toContain("/api/restaurants (500)");
    expect(by.protected).toMatchObject({ status: "fail", severity: "critical", note: "ouvertes sans connexion : /api/livreur/me" });
    expect(by.cors).toMatchObject({ status: "fail", severity: "high" });
  });

  it("repère une trace technique, un gros envoi accepté, une limite absente et une migration manquante", async () => {
    const fetcher = site((path, init) => {
      if (path !== "/api/track") return undefined;
      return String(init?.body).length > 100_000 ? new Response("{}", { status: 200 }) : new Response("SyntaxError: Unexpected end of JSON\n    at parse (node_modules/body-parser/x.js:1)", { status: 500 });
    });
    const { prisma } = db([{ name: "0001_init.sql" }]);
    const by = Object.fromEntries((await liveChecks(prisma, config(fetcher, { limiters: { connexion: true, "codes SMS": false } }))).map((c) => [c.key, c]));
    expect(by.leak).toMatchObject({ status: "fail", severity: "moderate" });
    expect(by.bigBody).toMatchObject({ status: "warn" });
    expect(by.rateLimits).toMatchObject({ status: "fail", note: "absentes : codes SMS" });
    expect(by.migrations).toMatchObject({ status: "fail", severity: "high" });
  });

  it("site injoignable : critique", async () => {
    const checks = await liveChecks(db().prisma, config(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(checks.find((c) => c.key === "headers")).toMatchObject({ status: "fail", severity: "critical" });
  });
});

describe("bilan quotidien : rapport du dépôt", () => {
  const now = new Date(Date.UTC(2026, 10, 23, 6));
  const report: CiReport = {
    generatedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    npmAudit: { critical: 0, high: 1, moderate: 3, low: 0 },
    secrets: { findings: 0 },
    semgrep: { error: 0, warning: 0 },
    tests: { ok: true, note: "635 réussis" },
    tls: { daysLeft: 71, protocol: "TLSv1.3" },
  };

  it("lit dépendances, secrets, code, tests et certificat", () => {
    const by = Object.fromEntries(ciChecks(report, now).map((c) => [c.key, c]));
    expect(by.deps).toMatchObject({ status: "warn", severity: "high" });
    expect(by.secrets.status).toBe("ok");
    expect(by.tests).toMatchObject({ status: "ok", note: "635 réussis" });
    expect(by.tls).toMatchObject({ status: "ok", note: "expire dans 71 j" });
  });

  it("certificat bientôt expiré, secret trouvé, tests en échec", () => {
    const by = Object.fromEntries(ciChecks({ ...report, secrets: { findings: 2 }, tests: { ok: false }, tls: { daysLeft: 5, protocol: "TLSv1.3" } }, now).map((c) => [c.key, c]));
    expect(by.secrets.severity).toBe("critical");
    expect(by.tests.severity).toBe("high");
    expect(by.tls.severity).toBe("critical");
  });

  it("rapport absent ou trop vieux : à surveiller", () => {
    expect(ciChecks(null, now)).toEqual([expect.objectContaining({ key: "ci", status: "warn" })]);
    expect(ciChecks({ ...report, generatedAt: "2026-11-20T05:00:00Z" }, now)[0].note).toBe("rapport de plus de 36 h");
  });

  it("compte les failles des dépendances et des contrôles", () => {
    const fresh = { ...report, generatedAt: new Date().toISOString() };
    const counts = countFindings([...ciChecks(fresh, new Date()), { key: "cors", label: "CORS", group: "api", status: "fail", note: "", severity: "high" }], fresh);
    expect(counts).toEqual({ critical: 0, high: 2, moderate: 3, low: 0 });
  });
});

describe("bilan quotidien : enregistrement et alerte", () => {
  it("enregistre le bilan du jour avec le rapport du dépôt", async () => {
    const { prisma, saved } = db();
    const ci: CiReport = { generatedAt: new Date().toISOString(), npmAudit: { critical: 0, high: 0, moderate: 0, low: 0 }, secrets: { findings: 0 }, semgrep: { error: 0, warning: 0 }, tests: { ok: true }, tls: { daysLeft: 60, protocol: "TLSv1.3" } };
    const fetcher = site((path) => (path.endsWith("bilan.json") ? new Response(JSON.stringify(ci)) : undefined));
    const result = await runAudit(prisma, config(fetcher, { ciReportUrl: `${ORIGIN}/bilan.json` }));
    expect(result.counts).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 });
    expect(result.checks.every((c) => c.status === "ok")).toBe(true);
    expect(saved).toHaveLength(1);
  });

  it("prévient l'équipe d'une faille critique, une fois toutes les 12 h", async () => {
    const sent: { category: string; title: string; alarm?: boolean }[] = [];
    const notifier = { publicKey: "", push: async () => 0, sms: async () => {}, staff: async (category: string, p: { title: string; alarm?: boolean }) => (sent.push({ category, title: p.title, alarm: p.alarm }), 1) };
    let recent: { id: string } | null = null;
    const prisma = { staffNotification: { findFirst: async () => recent } } as unknown as PrismaClient;
    const result = { day: "2026-11-23", ranAt: "", durationSec: 3, ci: null, counts: { critical: 1, high: 0, moderate: 0, low: 0 }, checks: [{ key: "protected", label: "Routes protégées", group: "api" as const, status: "fail" as const, note: "ouvertes", severity: "critical" as const }] };
    expect(await alertAudit(prisma, notifier, result)).toBe("Bilan de sécurité : faille critique");
    expect(sent).toEqual([{ category: "TECH", title: "Bilan de sécurité : faille critique", alarm: true }]);
    recent = { id: "n1" };
    expect(await alertAudit(prisma, notifier, result)).toBeNull();
    expect(await alertAudit(prisma, notifier, { ...result, counts: { critical: 0, high: 0, moderate: 2, low: 0 }, checks: [] })).toBeNull();
  });
});

describe("API : envois refusés sans détail technique", () => {
  it("JSON illisible : 400, gros envoi : 413, sans trace", async () => {
    const app = createApp({} as PrismaClient, { frontendOrigin: "", zedekaWhatsapp: "" });
    const bad = await request(app).post("/api/track").set("Content-Type", "application/json").send("{").expect(400);
    expect(bad.body).toEqual({ error: "Requête invalide" });
    const big = await request(app).post("/api/track").set("Content-Type", "application/json").send(JSON.stringify({ x: "a".repeat(300_000) })).expect(413);
    expect(big.body).toEqual({ error: "Envoi trop volumineux" });
  });

  it("bilan à la demande : directeur et adjoint seulement", async () => {
    const { staffMay } = await import("./team.js");
    expect(staffMay("DEPUTY", "POST", "/tech/audit/run")).toBe(true);
    expect(staffMay("MANAGER", "GET", "/tech/audits")).toBe(false);
    expect(staffMay("ACCOUNTANT", "GET", "/tech/audits")).toBe(false);
  });
});
