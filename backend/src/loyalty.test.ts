import { describe, expect, it } from "vitest";
import { challengeLive, extendPlus, extendSponsor, isSponsored, loyaltyBalance, plusActive, plusDiscount, plusState, pointsFor, sponsoredFirst } from "./loyalty.js";

const NOW = new Date("2026-11-23T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const plus = { plusEnabled: true, plusDeliveryDiscount: 100, plusMinSubtotal: 3000, plusMonthlyFee: 2500 };

describe("Zedeka+", () => {
  it("abonné tant que la date de fin n'est pas passée", () => {
    expect(plusActive(null, NOW)).toBe(false);
    expect(plusActive(new Date(NOW.getTime() + 1000), NOW)).toBe(true);
    expect(plusActive(new Date(NOW.getTime() - 1000), NOW)).toBe(false);
  });
  it("livraison offerte dès le panier minimum", () => {
    expect(plusDiscount(800, 3000, plus)).toBe(800);
    expect(plusDiscount(800, 2999, plus)).toBe(0);
    expect(plusDiscount(0, 5000, plus)).toBe(0);
  });
  it("remise partielle en pourcentage, jamais au-delà des frais", () => {
    expect(plusDiscount(900, 5000, { ...plus, plusDeliveryDiscount: 50 })).toBe(450);
    expect(plusDiscount(900, 5000, { ...plus, plusDeliveryDiscount: 150 })).toBe(900);
  });
  it("coupé dans les réglages : aucune remise", () => {
    expect(plusDiscount(800, 5000, { ...plus, plusEnabled: false })).toBe(0);
  });
  it("un paiement prolonge depuis la fin en cours, sinon depuis aujourd'hui", () => {
    const running = new Date(NOW.getTime() + 5 * DAY);
    expect(extendPlus(running, 1, NOW)).toEqual({ startsAt: running, endsAt: new Date(running.getTime() + 30 * DAY) });
    const expired = new Date(NOW.getTime() - 5 * DAY);
    expect(extendPlus(expired, 2, NOW)).toEqual({ startsAt: NOW, endsAt: new Date(NOW.getTime() + 60 * DAY) });
  });
  it("état montré au client", () => {
    const s = plusState({ plusUntil: new Date(NOW.getTime() + DAY), plusRequestedAt: null }, plus, NOW);
    expect(s).toMatchObject({ enabled: true, active: true, monthlyFee: 2500, deliveryDiscount: 100, minSubtotal: 3000 });
  });
});

describe("points de fidélité", () => {
  const rules = { loyaltySpendPerPoint: 100, loyaltyRewardPoints: 300 };
  it("1 point par 100 F dépensés, arrondi en dessous", () => {
    expect(pointsFor(12_399, 100)).toBe(123);
    expect(pointsFor(99, 100)).toBe(0);
    expect(pointsFor(5000, 0)).toBe(0);
  });
  it("solde, livraisons offertes et points manquants", () => {
    expect(loyaltyBalance(70_000, 300, rules)).toEqual({ earned: 700, redeemed: 300, points: 400, rewardPoints: 300, rewards: 1, toNext: 200, spendPerPoint: 100 });
  });
  it("le solde ne passe jamais sous zéro", () => {
    expect(loyaltyBalance(1000, 300, rules).points).toBe(0);
  });
  it("points coupés : aucune livraison offerte", () => {
    expect(loyaltyBalance(90_000, 0, { ...rules, loyaltySpendPerPoint: 0 }).rewards).toBe(0);
    expect(loyaltyBalance(90_000, 0, { ...rules, loyaltyRewardPoints: 0 }).rewards).toBe(0);
  });
});

describe("défis des livreurs", () => {
  const c = { active: true, startsAt: new Date(NOW.getTime() - DAY), endsAt: new Date(NOW.getTime() + DAY) };
  it("en cours entre le début et la fin, s'il est actif", () => {
    expect(challengeLive(c, NOW)).toBe(true);
    expect(challengeLive({ ...c, active: false }, NOW)).toBe(false);
    expect(challengeLive(c, new Date(NOW.getTime() + 2 * DAY))).toBe(false);
  });
});

describe("mises en avant", () => {
  it("une semaine de plus depuis la fin en cours", () => {
    const until = new Date(NOW.getTime() + 2 * DAY);
    expect(extendSponsor(until, 1, NOW).endsAt).toEqual(new Date(until.getTime() + 7 * DAY));
    expect(extendSponsor(null, 2, NOW)).toEqual({ startsAt: NOW, endsAt: new Date(NOW.getTime() + 14 * DAY) });
    expect(isSponsored(until, NOW)).toBe(true);
  });
  it("les commerces mis en avant passent devant, sans changer l'ordre", () => {
    const list = [
      { n: "a", sponsored: false },
      { n: "b", sponsored: true },
      { n: "c", sponsored: false },
      { n: "d", sponsored: true },
    ];
    expect(sponsoredFirst(list).map((x) => x.n)).toEqual(["b", "d", "a", "c"]);
  });
});
