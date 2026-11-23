import { describe, expect, it } from "vitest";
import { categoryFilter, CATEGORY_KEYS, DAILY_CATEGORIES } from "./store.js";
import { MODULES } from "./services.js";

describe("courses du quotidien", () => {
  it("les catégories du quotidien existent parmi les catégories de boutique", () => {
    for (const k of DAILY_CATEGORIES) expect(CATEGORY_KEYS).toContain(k);
  });

  it("filtre : une catégorie précise passe avant le groupe", () => {
    expect(categoryFilter("pharmacie", "quotidien")).toBe("pharmacie");
    expect(categoryFilter(null, "quotidien")).toEqual({ in: ["supermarche", "pharmacie", "gaz-eau", "epicerie"] });
    expect(categoryFilter(null, null)).toBeUndefined();
    expect(categoryFilter(null, "autre")).toBeUndefined();
  });

  it("le module DAILY est construit, coupé par défaut et mène à /app/courses", () => {
    const daily = MODULES.find((m) => m.code === "DAILY");
    expect(daily).toMatchObject({ built: true, defaultState: "OFF", href: "/app/courses" });
  });
});
