import { describe, expect, it } from "vitest";
import { issueToken, readToken, verifyToken } from "./auth.js";
import { availability, isOpenAt, nextOpening, openingHoursInput } from "./openingHours.js";
import { translateMessage } from "./i18n.js";
import type { Order, PrismaClient } from "@prisma/client";
import { canRestaurantMove, COUNTER_COMMISSION_FROM, OWED_TO_RESTAURANT, SETTLED_BY_STATEMENT, statusUpdate, stepView } from "./orderFlow.js";

describe("horaires d'ouverture", () => {
  const mondayLunch = [{ day: 1, open: "11:00", close: "15:00" }];
  const night = [{ day: 5, open: "18:00", close: "02:00" }]; // vendredi soir

  it("ouvre pendant le créneau, ferme en dehors", () => {
    expect(isOpenAt(mondayLunch, new Date("2026-10-26T12:00:00Z"))).toBe(true); // lundi
    expect(isOpenAt(mondayLunch, new Date("2026-10-26T15:00:00Z"))).toBe(false);
    expect(isOpenAt(mondayLunch, new Date("2026-10-27T12:00:00Z"))).toBe(false); // mardi
  });

  it("gère un créneau qui passe minuit", () => {
    expect(isOpenAt(night, new Date("2026-10-30T23:00:00Z"))).toBe(true); // vendredi
    expect(isOpenAt(night, new Date("2026-10-31T01:30:00Z"))).toBe(true); // samedi tôt
    expect(isOpenAt(night, new Date("2026-10-31T03:00:00Z"))).toBe(false);
  });

  it("sans horaires, reste ouvert sauf fermeture temporaire", () => {
    expect(availability({ active: true, temporarilyClosed: false, openingHours: [] }).open).toBe(true);
    expect(availability({ active: true, temporarilyClosed: true, openingHours: [] }).open).toBe(false);
  });

  it("annonce la prochaine ouverture quand le restaurant est fermé", () => {
    const week = [
      { day: 1, open: "11:00", close: "15:00" },
      { day: 1, open: "18:00", close: "22:00" },
    ];
    const r = { active: true, temporarilyClosed: false, openingHours: week };
    // lundi 9 h : ouvre à 11 h ; lundi 16 h : rouvre à 18 h ; lundi 23 h : lundi prochain
    expect(availability(r, new Date("2026-10-26T09:00:00Z")).reason).toBe("Le restaurant est fermé à cette heure-ci. Ouverture aujourd'hui à 11:00.");
    expect(availability(r, new Date("2026-10-26T16:00:00Z")).reason).toBe("Le restaurant est fermé à cette heure-ci. Ouverture aujourd'hui à 18:00.");
    expect(availability(r, new Date("2026-10-26T23:00:00Z")).reason).toBe("Le restaurant est fermé à cette heure-ci. Ouverture lundi à 11:00.");
    expect(availability(r, new Date("2026-10-25T20:00:00Z")).reason).toBe("Le restaurant est fermé à cette heure-ci. Ouverture demain à 11:00."); // dimanche soir
    expect(nextOpening([], new Date())).toBeNull();
    expect(translateMessage("Le restaurant est fermé à cette heure-ci. Ouverture demain à 11:00.", "en")).toBe("The restaurant is closed at this time. Opens tomorrow at 11:00.");
    expect(translateMessage("Le restaurant est fermé à cette heure-ci. Ouverture lundi à 11:00.", "en")).toBe("The restaurant is closed at this time. Opens on Monday at 11:00.");
  });

  it("valide les créneaux saisis et les trie", () => {
    const ok = openingHoursInput.safeParse([
      { day: 2, open: "18:00", close: "23:00" },
      { day: 2, open: "11:00", close: "15:00" },
      { day: 1, open: "18:00", close: "02:00" },
    ]);
    expect(ok.success && ok.data.map((s) => `${s.day} ${s.open}`)).toEqual(["1 18:00", "2 11:00", "2 18:00"]);
    expect(openingHoursInput.safeParse([{ day: 1, open: "11:00", close: "11:00" }]).success).toBe(false);
    expect(openingHoursInput.safeParse([{ day: 7, open: "11:00", close: "12:00" }]).success).toBe(false);
    expect(openingHoursInput.safeParse([{ day: 1, open: "25:00", close: "12:00" }]).success).toBe(false);
  });
});

describe("actions du restaurant", () => {
  it("autorise accepter, préparer, déclarer prête et refuser au départ", () => {
    expect(canRestaurantMove("PENDING", "CONFIRMED")).toBe(true);
    expect(canRestaurantMove("PENDING", "CANCELLED")).toBe(true);
    expect(canRestaurantMove("PREPARING", "READY")).toBe(true);
    expect(canRestaurantMove("READY", "PICKED_UP")).toBe(false);
    expect(canRestaurantMove("PREPARING", "CANCELLED")).toBe(false);
  });

  it("clôture un retrait remis au client, jamais une livraison", () => {
    expect(canRestaurantMove("READY", "DELIVERED", "PICKUP")).toBe(true);
    expect(canRestaurantMove("READY", "DELIVERED", "DELIVERY")).toBe(false);
    expect(canRestaurantMove("READY", "DELIVERED")).toBe(false);
    expect(canRestaurantMove("PREPARING", "DELIVERED", "PICKUP")).toBe(false);
  });

  it("un retrait remis au client est payé, sans part livreur", async () => {
    const prisma = { settings: { findFirst: async () => ({ foodDriverCommission: 70, parcelDriverCommission: 70 }) } } as unknown as PrismaClient;
    const order = { status: "READY", type: "FOOD", fulfillment: "PICKUP", paymentMethod: "CASH", deliveryFee: 0, extraFee: 0, driverId: null } as unknown as Order;
    const update = await statusUpdate(prisma, order, "DELIVERED");
    expect(update.paymentStatus).toBe("PAID");
    expect(update.driverEarning).toBe(0);
    expect(update.deliveredAt).toBeInstanceOf(Date);
  });

  const rules = { freeCancellationMinutes: 5, cancellationFeePercent: 50, foodDriverCommission: 70, parcelDriverCommission: 70 };
  const settingsOnly = { settings: { findFirst: async () => rules } } as unknown as PrismaClient;
  const late = { status: "PENDING", type: "FOOD", fulfillment: "DELIVERY", deliveryFee: 1000, extraFee: 0, createdAt: new Date(Date.now() - 20 * 60_000) } as unknown as Order;

  it("un refus du restaurant ne retient aucun frais au client", async () => {
    expect((await statusUpdate(settingsOnly, late, "CANCELLED", { reason: "Plus de poulet" })).cancellationFee).toBe(500);
    expect((await statusUpdate(settingsOnly, late, "CANCELLED", { reason: "Plus de poulet", byRestaurant: true })).cancellationFee).toBe(0);
  });

  it("frais et part du livreur suivent les frais de livraison modifiés dans la même demande", async () => {
    expect((await statusUpdate(settingsOnly, late, "CANCELLED", { reason: "Client absent", deliveryFee: 2000 })).cancellationFee).toBe(1000);
    const picked = { ...late, status: "PICKED_UP", driverId: null, paymentMethod: "CASH" } as unknown as Order;
    expect((await statusUpdate(settingsOnly, picked, "DELIVERED", { deliveryFee: 2000 })).driverEarning).toBe(1400);
  });
});

describe("relevés des restaurants", () => {
  it("excluent les retraits payés au comptoir (le restaurant a encaissé)", () => {
    expect(OWED_TO_RESTAURANT).toEqual({ NOT: { fulfillment: "PICKUP", paymentMethod: "CASH" } });
  });

  it("reprennent la commission des retraits au comptoir livrés depuis la décision, pas les plus anciens", () => {
    expect(SETTLED_BY_STATEMENT).toEqual({
      paidFromDeposit: false,
      paidByDriver: false,
      OR: [OWED_TO_RESTAURANT, { fulfillment: "PICKUP", paymentMethod: "CASH", commission: { gt: 0 }, deliveredAt: { gte: COUNTER_COMMISSION_FROM } }],
    });
  });
});

describe("jetons par rôle", () => {
  it("sépare admin et restaurant", () => {
    const r = issueToken("s", 0, "restaurant", "resto-1");
    expect(readToken(r, "s", 1)).toMatchObject({ r: "restaurant", s: "resto-1" });
    expect(verifyToken(r, "s", 1)).toBe(false);
    expect(verifyToken(issueToken("s", 0), "s", 1)).toBe(true);
  });
});

describe("étapes vues par le restaurant", () => {
  const driver = { id: "d1", name: "Kofi", phone: "+228 90 00 00 00" };
  const base = { driver, customerPhone: "+228 91 11 11 11", confirmedAt: null as Date | null };

  it("cache le livreur et le numéro du client tant que la commande n'est pas acceptée", () => {
    const pending = stepView({ ...base, status: "PENDING" });
    expect(pending.driver).toBeNull();
    expect(pending.customerPhone).toBe("");
    const refused = stepView({ ...base, status: "CANCELLED" });
    expect(refused.driver).toBeNull();
  });

  it("les montre une fois la commande acceptée", () => {
    const at = new Date();
    expect(stepView({ ...base, status: "CONFIRMED", confirmedAt: at }).driver).toEqual(driver);
    expect(stepView({ ...base, status: "READY", confirmedAt: at }).customerPhone).toBe("+228 91 11 11 11");
    expect(stepView({ ...base, status: "CANCELLED", confirmedAt: at }).driver).toEqual(driver);
  });
});
