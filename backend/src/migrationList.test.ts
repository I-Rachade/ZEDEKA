import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "./migrationList.js";

describe("liste des migrations du bilan quotidien", () => {
  it("suit le dossier migrations/ (mettre à jour src/migrationList.ts avec chaque migration)", () => {
    const files = readdirSync(new URL("../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql")).sort();
    expect(MIGRATION_COUNT).toBe(files.length);
    expect(LATEST_MIGRATION).toBe(files[files.length - 1]);
  });
});
