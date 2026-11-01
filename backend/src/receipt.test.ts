import { describe, expect, it } from "vitest";
import { AUTO_CLOSE_MS, codeMatches, dueForAutoClose, newDeliveryCode, receiptState, RATING_WINDOW_MS } from "./receipt.js";

const now = new Date("2026-11-01T20:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const base = { status: "PICKED_UP" as const, handedOverAt: null, receiptDisputedAt: null, deliveredAt: null, driverId: "d1", ratedAt: null, fulfillment: "DELIVERY" as const };

describe("clôture par le client", () => {
  it("attend le client une fois la remise déclarée par le livreur", () => {
    expect(receiptState(base, now)).toBeNull();
    expect(receiptState({ ...base, handedOverAt: ago(60_000) }, now)).toBe("CONFIRM");
    expect(receiptState({ ...base, handedOverAt: ago(60_000), receiptDisputedAt: now }, now)).toBe("DISPUTED");
  });

  it("laisse noter une livraison clôturée par code ou automatiquement, pendant 7 jours", () => {
    const delivered = { ...base, status: "DELIVERED" as const, deliveredAt: ago(3_600_000) };
    expect(receiptState(delivered, now)).toBe("RATE");
    expect(receiptState({ ...delivered, ratedAt: now }, now)).toBeNull();
    expect(receiptState({ ...delivered, deliveredAt: ago(RATING_WINDOW_MS + 1) }, now)).toBeNull();
    expect(receiptState({ ...delivered, driverId: null }, now)).toBeNull();
  });

  it("clôture d'elle-même après 30 min sans réponse, sauf contestation", () => {
    expect(dueForAutoClose({ ...base, handedOverAt: ago(AUTO_CLOSE_MS - 1000) }, now)).toBe(false);
    expect(dueForAutoClose({ ...base, handedOverAt: ago(AUTO_CLOSE_MS) }, now)).toBe(true);
    expect(dueForAutoClose({ ...base, handedOverAt: ago(AUTO_CLOSE_MS), receiptDisputedAt: now }, now)).toBe(false);
    expect(dueForAutoClose({ ...base, status: "DELIVERED", handedOverAt: ago(AUTO_CLOSE_MS) }, now)).toBe(false);
  });

  it("code à 4 chiffres", () => {
    expect(newDeliveryCode(() => 0.0042)).toBe("0042");
    expect(newDeliveryCode()).toMatch(/^\d{4}$/);
    expect(codeMatches("0042", "00 42")).toBe(true);
    expect(codeMatches("0042", "0043")).toBe(false);
    expect(codeMatches(null, "0042")).toBe(false);
    expect(codeMatches("0042", undefined)).toBe(false);
  });
});
