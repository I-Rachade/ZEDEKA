import { describe, expect, it } from "vitest";
import { slugify } from "./routes/adminVendors.js";

describe("lien d'un partenaire validé", () => {
  it("retire accents et ponctuation", () => {
    expect(slugify("Chez Tante Ama")).toBe("chez-tante-ama");
    expect(slugify("Pâtisserie l'Étoile d'Or !")).toBe("patisserie-l-etoile-d-or");
    expect(slugify("!!!")).toBe("partenaire");
  });
});
