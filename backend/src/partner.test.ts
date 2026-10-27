import { describe, expect, it } from "vitest";
import { closedUntilFor, planOrderEdit } from "./partner.js";

describe("closedUntilFor", () => {
  const now = new Date("2026-10-27T20:15:00Z");
  it("calcule la fin de fermeture", () => {
    expect(closedUntilFor("30m", now)?.toISOString()).toBe("2026-10-27T20:45:00.000Z");
    expect(closedUntilFor("1h", now)?.toISOString()).toBe("2026-10-27T21:15:00.000Z");
    expect(closedUntilFor("tomorrow", now)?.toISOString()).toBe("2026-10-28T06:00:00.000Z");
    expect(closedUntilFor("indefinite", now)).toBeNull();
  });
});

describe("planOrderEdit", () => {
  const items = [
    { id: "a", menuItemId: "riz", name: "Riz poulet", variantName: null, unitPrice: 2500, quantity: 2 },
    { id: "b", menuItemId: "jus", name: "Bissap", variantName: null, unitPrice: 500, quantity: 3 },
  ];
  const menu = [
    { id: "eau", name: "Eau", price: 400 },
    { id: "fanta", name: "Fanta", price: 700 },
  ];

  it("baisse une quantité et remplace par moins cher", () => {
    const plan = planOrderEdit(items, [{ itemId: "b", quantity: 1, replacementId: "eau" }], menu);
    expect(plan.updates).toEqual([{ id: "b", quantity: 1 }]);
    expect(plan.additions).toEqual([{ menuItemId: "eau", name: "Eau", unitPrice: 400, quantity: 2 }]);
    expect(plan.subtotal).toBe(2 * 2500 + 500 + 2 * 400);
    expect(plan.changes[0]).toEqual({ name: "Bissap", from: 3, to: 1, replacement: "Eau" });
  });

  it("retire un article", () => {
    expect(planOrderEdit(items, [{ itemId: "a", quantity: 0 }], menu).subtotal).toBe(1500);
  });

  it("refuse un remplacement plus cher, une hausse, une commande vide", () => {
    expect(() => planOrderEdit(items, [{ itemId: "b", quantity: 2, replacementId: "fanta" }], menu)).toThrow(/même prix/);
    expect(() => planOrderEdit(items, [{ itemId: "b", quantity: 4 }], menu)).toThrow(/Quantité/);
    expect(() => planOrderEdit(items, [{ itemId: "a", quantity: 0 }, { itemId: "b", quantity: 0 }], menu)).toThrow(/vide/);
    expect(() => planOrderEdit(items, [{ itemId: "a", quantity: 2 }], menu)).toThrow(/Aucune/);
  });
});
