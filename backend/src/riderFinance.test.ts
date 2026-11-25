import { describe, expect, it } from "vitest";
import { canMove, driverView, productLabel, remaining, statusMessage } from "./riderFinance.js";

describe("assurance et micro-crédit", () => {
  it("n'autorise que les étapes suivantes", () => {
    expect(canMove("REQUESTED", "SENT")).toBe(true);
    expect(canMove("SENT", "ACTIVE")).toBe(false);
    expect(canMove("APPROVED", "ACTIVE")).toBe(true);
    expect(canMove("ACTIVE", "REQUESTED")).toBe(false);
    expect(canMove("CLOSED", "ACTIVE")).toBe(false);
    expect(canMove("BIDON", "SENT")).toBe(false);
  });
  it("calcule le reste à rembourser d'un crédit", () => {
    const loan = { kind: "LOAN", totalDue: 55_000, approvedAmount: 50_000, repayments: [{ amount: 20_000 }, { amount: 10_000 }] };
    expect(remaining(loan)).toBe(25_000);
    expect(remaining({ ...loan, totalDue: null })).toBe(20_000);
    expect(remaining({ ...loan, repayments: [{ amount: 60_000 }] })).toBe(0);
    expect(remaining({ ...loan, kind: "INSURANCE" })).toBeNull();
    expect(remaining({ ...loan, totalDue: null, approvedAmount: null })).toBeNull();
  });
  it("prévient le livreur avec le nom du partenaire", () => {
    expect(statusMessage("LOAN", "SENT", "Microfi")).toBe("Votre demande de crédit a été transmise à Microfi.");
    expect(statusMessage("INSURANCE", "ACTIVE", null)).toBe("Votre assurance est active.");
    expect(statusMessage("CLAIM", "REQUESTED", null)).toBeNull();
  });
  it("cache les notes internes au livreur", () => {
    const v = driverView({
      id: "r1",
      kind: "LOAN",
      product: "REPAIR",
      amount: 50_000,
      months: 6,
      note: "Pneus",
      incidentAt: null,
      parentId: null,
      status: "ACTIVE",
      partner: "Microfi",
      partnerRef: "X-1",
      approvedAmount: 50_000,
      totalDue: 54_000,
      installment: 9_000,
      startsAt: null,
      endsAt: null,
      staffNote: "Interne",
      createdAt: new Date(0),
      repayments: [{ id: "p1", amount: 9_000, method: "CASH", reference: null, createdAt: new Date(0) }],
    });
    expect(v).not.toHaveProperty("staffNote");
    expect(v).not.toHaveProperty("partnerRef");
    expect(v).toMatchObject({ productLabel: productLabel("LOAN", "REPAIR"), paid: 9_000, remaining: 45_000 });
  });
});
