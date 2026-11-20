import { describe, expect, it } from "vitest";
import { foodDetails, formatFcfa, normalizeCode, orderCode, priceOrder, whatsappMessage, whatsappUrl } from "./pricing.js";

const items = [
  { id: "a", name: "Riz", price: 2500, variants: [], addons: [] },
  { id: "b", name: "Bissap", price: 500, variants: [], addons: [] },
];

describe("priceOrder", () => {
  it("calcule le total avec les prix de la base et fusionne les doublons", () => {
    const r = priceOrder(
      [
        { menuItemId: "a", quantity: 1 },
        { menuItemId: "b", quantity: 2 },
        { menuItemId: "a", quantity: 1 },
      ],
      items,
      1000,
    );
    expect(r.subtotal).toBe(6000);
    expect(r.total).toBe(7000);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ menuItemId: "a", quantity: 2, unitPrice: 2500 });
  });

  it("refuse un article inconnu", () => {
    expect(() => priceOrder([{ menuItemId: "x", quantity: 1 }], items, 1000)).toThrow();
  });

  const fufu = {
    id: "f",
    name: "Fufu",
    price: 2000,
    variants: [{ id: "g", name: "Grande", price: 3000 }],
    addons: [],
    options: [
      { name: "Sauce", values: ["Arachide", "Tomate"] },
      { name: "Piment", values: ["Doux", "Fort"] },
    ],
  };

  it("garde les choix sans prix dans le libellé et sépare les lignes de choix différents", () => {
    const r = priceOrder(
      [
        { menuItemId: "f", quantity: 1, variantId: "g", choices: ["Arachide", "Fort"] },
        { menuItemId: "f", quantity: 1, variantId: "g", choices: ["Tomate", "Fort"] },
        { menuItemId: "f", quantity: 1, variantId: "g", choices: ["Arachide", "Fort"] },
      ],
      [fufu],
      0,
    );
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ variantName: "Grande · Sauce : Arachide · Piment : Fort", quantity: 2, unitPrice: 3000 });
    expect(r.subtotal).toBe(9000);
  });

  it("demande un choix par groupe, parmi ceux proposés", () => {
    expect(() => priceOrder([{ menuItemId: "f", quantity: 1, variantId: "g", choices: ["Arachide"] }], [fufu], 0)).toThrow("Choisissez « Piment »");
    expect(() => priceOrder([{ menuItemId: "f", quantity: 1, variantId: "g", choices: ["Gombo", "Fort"] }], [fufu], 0)).toThrow("Choisissez « Sauce »");
  });

  it("respecte le stock, toutes variantes confondues", () => {
    const pagne = { id: "p", name: "Pagne", price: 5000, variants: [], addons: [], stock: 2 };
    expect(priceOrder([{ menuItemId: "p", quantity: 2 }], [pagne], 0).subtotal).toBe(10000);
    expect(() => priceOrder([{ menuItemId: "p", quantity: 3 }], [pagne], 0)).toThrow("Plus que 2");
    expect(() => priceOrder([{ menuItemId: "p", quantity: 1 }], [{ ...pagne, stock: 0 }], 0)).toThrow("épuisé");
    expect(priceOrder([{ menuItemId: "p", quantity: 30 }], [{ ...pagne, stock: null }], 0).lines[0].quantity).toBe(30);
  });
});

describe("format et WhatsApp", () => {
  it("formate les montants en FCFA", () => {
    expect(formatFcfa(13500)).toBe("13 500 FCFA");
  });

  it("génère un code de 8 caractères", () => {
    expect(orderCode()).toMatch(/^ZD-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("remet en forme un code saisi à la main", () => {
    expect(normalizeCode(" zd k7mq 3xpa ")).toBe("ZD-K7MQ-3XPA");
    expect(normalizeCode("ZDK7MQ3XPA")).toBe("ZD-K7MQ-3XPA");
    expect(normalizeCode("zl-k7mq-3xpa")).toBe("ZL-K7MQ-3XPA");
    expect(normalizeCode("zd-b4q4")).toBe("ZD-B4Q4");
    expect(normalizeCode("zdb4q4")).toBe("ZD-B4Q4");
  });

  it("construit le message et le lien", () => {
    const msg = whatsappMessage({
      code: "ZD-AAAA",
      title: "Restaurant : Chez Tante Ama",
      zoneName: "Zone 1",
      customerName: "Kossi",
      customerPhone: "90000000",
      address: "Tokoin",
      paymentMethod: "CASH",
      details: foodDetails([{ menuItemId: "a", name: "Riz", variantName: null, addons: [], unitPrice: 2500, quantity: 2 }]),
      subtotal: 5000,
      deliveryFee: 1000,
      total: 6000,
    });
    expect(msg).toContain("2 x Riz (5 000 FCFA)");
    expect(msg).toContain("Total : 6 000 FCFA");
    expect(whatsappUrl("22890000000", msg)).toMatch(/^https:\/\/wa\.me\/22890000000\?text=/);
  });
});
