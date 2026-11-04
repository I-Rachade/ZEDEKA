import { describe, expect, it } from "vitest";
import { maskPhone } from "./routes/public.js";

// Numéros montrés sur la page de suivi : on reconnaît le numéro sans pouvoir le recopier.
describe("numéro masqué du suivi", () => {
  it("garde l'indicatif, les deux premiers et les deux derniers chiffres", () => {
    expect(maskPhone("+22890123456")).toBe("+228 90 •• •• 56");
    expect(maskPhone("90 12 34 56")).toBe("90 •• •• 56");
  });
  it("ne montre rien d'un numéro trop court", () => {
    expect(maskPhone("123")).toBe("••");
  });
});
