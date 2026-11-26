import { describe, expect, it } from "vitest";
import { dispatchRepoReport, reportIsStale } from "./repoReport.js";

describe("rapport du dépôt à l'heure pour le bilan", () => {
  it("lance le workflow sur la branche par défaut du dépôt", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetcher = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.endsWith("/dispatches") ? new Response(null, { status: 204 }) : Response.json({ default_branch: "principale" });
    };
    expect(await dispatchRepoReport("jeton", "moi/depot", fetcher)).toBe(true);
    expect(calls[1].url).toBe("https://api.github.com/repos/moi/depot/actions/workflows/bilan-quotidien.yml/dispatches");
    expect(JSON.parse(calls[1].init!.body as string)).toEqual({ ref: "principale" });
    expect((calls[1].init!.headers as Record<string, string>).Authorization).toBe("Bearer jeton");
  });

  it("ne fait rien sans jeton, et rend false si GitHub refuse", async () => {
    let called = false;
    expect(await dispatchRepoReport(undefined, "moi/depot", async () => ((called = true), new Response()))).toBe(false);
    expect(called).toBe(false);
    expect(await dispatchRepoReport("jeton", "moi/depot", async () => new Response("{}", { status: 401 }))).toBe(false);
  });

  it("rapport absent, illisible ou de la veille : à refaire ; rapport du matin : bon", () => {
    const now = new Date("2026-11-26T07:00:00Z");
    expect(reportIsStale(null, now)).toBe(true);
    expect(reportIsStale("pas du json", now)).toBe(true);
    expect(reportIsStale(JSON.stringify({ generatedAt: "2026-11-25T15:54:55Z" }), now)).toBe(true);
    expect(reportIsStale(JSON.stringify({ generatedAt: "2026-11-26T05:38:00Z" }), now)).toBe(false);
  });
});
