import { describe, expect, it } from "vitest";
import { formatFcfa, orderCode, priceOrder, whatsappMessage, whatsappUrl } from "./pricing.js";

const items = [
  { id: "a", name: "Riz", price: 2500 },
  { id: "b", name: "Bissap", price: 500 },
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
});

describe("format et WhatsApp", () => {
  it("formate les montants en FCFA", () => {
    expect(formatFcfa(13500)).toBe("13 500 FCFA");
  });

  it("génère un code court", () => {
    expect(orderCode()).toMatch(/^ZD-[A-Z2-9]{4}$/);
  });

  it("construit le message et le lien", () => {
    const msg = whatsappMessage({
      code: "ZD-AAAA",
      restaurantName: "Chez Tante Ama",
      zoneName: "Zone 1",
      customerName: "Kossi",
      customerPhone: "90000000",
      address: "Tokoin",
      paymentMethod: "CASH",
      items: [{ name: "Riz", unitPrice: 2500, quantity: 2 }],
      subtotal: 5000,
      deliveryFee: 1000,
      total: 6000,
    });
    expect(msg).toContain("2 x Riz (5 000 FCFA)");
    expect(msg).toContain("Total : 6 000 FCFA");
    expect(whatsappUrl("22890000000", msg)).toMatch(/^https:\/\/wa\.me\/22890000000\?text=/);
  });
});
