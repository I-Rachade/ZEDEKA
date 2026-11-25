import { describe, expect, it } from "vitest";
import { codesOf, DETAILS, estimateFor, slotError, summaryOf } from "./serviceRequests.js";

const now = new Date("2026-11-06T09:00:00Z");
const at = (iso: string) => new Date(iso);

describe("demandes de service", () => {
  it("prix : base + unité × quantité (articles, sacs, heures), courses et dépannage à prix de base", () => {
    expect(estimateFor({ price: { base: 500, unit: 500, unitLabel: "article" } }, "GAS", { product: "GAS_12", quantity: 2 })).toBe(1500);
    expect(estimateFor({ price: { base: 500, unit: 2500, unitLabel: "sac" } }, "LAUNDRY", { bags: 3, ironing: true })).toBe(8000);
    expect(estimateFor({ price: { base: 0, unit: 2000, unitLabel: "heure" } }, "CLEANING", { hours: 4, place: "HOME", rooms: 3 })).toBe(8000);
    expect(estimateFor({ price: { base: 1000, unit: 0, unitLabel: null } }, "ERRAND", { items: "Riz, huile", budget: 15000 })).toBe(1000);
    expect(estimateFor({ price: { base: 2000, unit: 0, unitLabel: null } }, "REPAIR", { trade: "PLUMBING", problem: "Fuite sous l'évier" })).toBe(2000);
  });

  it("résumé lisible pour le prestataire et l'admin", () => {
    expect(summaryOf("GAS", { product: "GAS_12", quantity: 2 })).toBe("2 bouteilles de gaz 12 kg");
    expect(summaryOf("GAS", { product: "WATER", quantity: 1 })).toBe("1 bidon d'eau");
    expect(summaryOf("LAUNDRY", { bags: 1, ironing: true })).toBe("Lessive : 1 sac, avec repassage");
    expect(summaryOf("CLEANING", { hours: 3, place: "OFFICE", rooms: 2 })).toBe("Ménage 3 h (bureau, 2 pièces)");
    expect(summaryOf("ERRAND", { items: "Riz", budget: 15000, shop: "Champion" })).toBe("Courses chez Champion, budget 15 000 FCFA");
    expect(summaryOf("REPAIR", { trade: "ELECTRICITY", problem: "Plus de courant dans la cuisine" })).toBe("Électricité : Plus de courant dans la cuisine");
  });

  it("formulaires : valeurs hors limites refusées avec un message clair", () => {
    expect(DETAILS.ERRAND.safeParse({ items: "Riz", budget: 100 }).success).toBe(false);
    expect(DETAILS.GAS.safeParse({ product: "PETROLE", quantity: 1 }).success).toBe(false);
    expect(DETAILS.LAUNDRY.safeParse({ bags: 11 }).success).toBe(false);
    expect(DETAILS.CLEANING.safeParse({ hours: 1 }).success).toBe(false);
    const repair = DETAILS.REPAIR.safeParse({ trade: "PLUMBING", problem: "fuite" });
    expect(repair.success).toBe(false);
    expect(repair.error?.issues[0].message).toMatch(/Décrivez la panne/);
  });

  it("créneau : obligatoire à domicile, 30 min à 14 jours, de 7 h à 19 h", () => {
    expect(slotError("CLEANING", null, now)).toBe("Choisissez le jour et l'heure");
    expect(slotError("GAS", null, now)).toBeNull();
    expect(slotError("REPAIR", at("2026-11-06T09:10:00Z"), now)).toMatch(/30 minutes/);
    expect(slotError("REPAIR", at("2026-11-25T10:00:00Z"), now)).toMatch(/14 prochains jours/);
    expect(slotError("LAUNDRY", at("2026-11-07T21:00:00Z"), now)).toBe("Créneaux de 7 h à 19 h");
    expect(slotError("LAUNDRY", at("2026-11-07T08:00:00Z"), now)).toBeNull();
  });

  it("services d'un prestataire lus depuis son profil", () => {
    expect(codesOf("ERRAND, GAS,,")).toEqual(["ERRAND", "GAS"]);
    expect(codesOf(null)).toEqual([]);
  });
});
