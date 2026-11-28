import { describe, expect, it } from "vitest";
import { acceptReferral, merchantFee, monthStart, newReferralCode, normalizeReferralCode, planFee, proAdvised } from "./offers.js";

const prices = { vendorSubscriptionFee: 15000, proSubscriptionFee: 25000 };
const flat = { merchantFlatFee: 800, merchantFlatFrom: 20 };

describe("palier des commerces", () => {
  it("prix du palier d'après les réglages", () => {
    expect(planFee("ESSENTIEL", prices)).toBe(15000);
    expect(planFee("PRO", prices)).toBe(25000);
    expect(planFee("FREE", prices)).toBe(0);
  });
  it("Pro conseillé au-delà de 300 commandes livrées dans le mois", () => {
    expect(proAdvised("ESSENTIEL", 300, 300)).toBe(false);
    expect(proAdvised("ESSENTIEL", 301, 300)).toBe(true);
    expect(proAdvised("PRO", 900, 300)).toBe(false);
    expect(proAdvised("ESSENTIEL", 900, 0)).toBe(false);
    expect(proAdvised("FREE", 900, 300)).toBe(false);
  });
  it("début du mois en UTC", () => {
    expect(monthStart(new Date("2026-11-22T23:40:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("tarif boutique", () => {
  it("prix normal jusqu'au 20e colis du mois, 800 F ensuite", () => {
    expect(merchantFee(1500, 19, flat)).toBe(1500);
    expect(merchantFee(1500, 20, flat)).toBe(800);
  });
  it("jamais plus cher que le prix normal", () => {
    expect(merchantFee(600, 30, flat)).toBe(600);
  });
  it("seuil 0 : tarif coupé", () => {
    expect(merchantFee(1500, 50, { ...flat, merchantFlatFrom: 0 })).toBe(1500);
  });
});

describe("parrainage", () => {
  it("code de 6 caractères sans caractères ambigus", () => {
    const code = newReferralCode();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(newReferralCode(() => 0)).toBe("AAAAAA");
  });
  it("le code se tape sans souci de casse, d'espaces ni de tirets", () => {
    expect(normalizeReferralCode(" ab-c 123 ")).toBe("ABC123");
  });
});

describe("saisie du code d'un ami", () => {
  type Row = { id: string; referralCode: string | null; referredById: string | null; deletedAt: Date | null };
  const fake = (rows: Row[], delivered = 0) =>
    ({
      customer: {
        findUniqueOrThrow: async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id)!,
        findUnique: async ({ where }: { where: { referralCode: string } }) => rows.find((r) => r.referralCode === where.referralCode) ?? null,
        updateMany: async ({ where, data }: { where: { id: string }; data: { referredById: string } }) => {
          const r = rows.find((x) => x.id === where.id && !x.referredById);
          if (r) r.referredById = data.referredById;
          return { count: r ? 1 : 0 };
        },
      },
      order: { count: async () => delivered },
    }) as unknown as Parameters<typeof acceptReferral>[0];
  const people = (): Row[] => [
    { id: "ama", referralCode: "AMA234", referredById: null, deletedAt: null },
    { id: "kofi", referralCode: null, referredById: null, deletedAt: null },
  ];

  it("un nouveau client indique le code d'un ami, une seule fois", async () => {
    const rows = people();
    expect(await acceptReferral(fake(rows), "kofi", "ama 234")).toBeNull();
    expect(rows[1].referredById).toBe("ama");
    expect(await acceptReferral(fake(rows), "kofi", "AMA234")).toBe("Vous avez déjà indiqué le code d'un ami");
  });
  it("refuse son propre code, un code inconnu et un client déjà livré", async () => {
    expect(await acceptReferral(fake(people()), "ama", "AMA234")).toBe("C'est votre propre code : partagez-le à vos amis");
    expect(await acceptReferral(fake(people()), "kofi", "ZZZZZZ")).toBe("Code de parrainage inconnu");
    expect(await acceptReferral(fake(people(), 1), "kofi", "AMA234")).toMatch(/nouveaux clients/);
  });
});
