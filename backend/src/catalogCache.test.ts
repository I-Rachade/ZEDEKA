import { describe, expect, it } from "vitest";
import { catalogCache, invalidateCatalog } from "./catalogCache.js";

describe("cache des lectures publiques", () => {
  it("garde une lecture pendant la durée, la partage, et la relit après une modification", async () => {
    let now = 0;
    let reads = 0;
    const cached = catalogCache({}, 20_000, () => now);
    const load = async () => ++reads;
    expect(await Promise.all([cached("k", load), cached("k", load)])).toEqual([1, 1]);
    now = 19_999;
    expect(await cached("k", load)).toBe(1);
    invalidateCatalog();
    expect(await cached("k", load)).toBe(2);
    now = 50_000;
    expect(await cached("k", load)).toBe(3);
  });

  it("ne garde pas un échec, et ne garde rien quand la durée est nulle", async () => {
    let reads = 0;
    const cached = catalogCache({}, 20_000, () => 0);
    await expect(cached("k", async () => Promise.reject(new Error("panne")))).rejects.toThrow("panne");
    await new Promise((r) => setTimeout(r, 0));
    expect(await cached("k", async () => ++reads)).toBe(1);
    const none = catalogCache({}, 0);
    expect(await none("k", async () => ++reads)).toBe(2);
    expect(await none("k", async () => ++reads)).toBe(3);
  });
});
