import { describe, expect, it } from "vitest";
import { issueToken, readToken, verifyToken } from "./auth.js";
import { availability, isOpenAt } from "./openingHours.js";
import { canRestaurantMove } from "./orderFlow.js";

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
});

describe("actions du restaurant", () => {
  it("autorise accepter, préparer, déclarer prête et refuser au départ", () => {
    expect(canRestaurantMove("PENDING", "CONFIRMED")).toBe(true);
    expect(canRestaurantMove("PENDING", "CANCELLED")).toBe(true);
    expect(canRestaurantMove("PREPARING", "READY")).toBe(true);
    expect(canRestaurantMove("READY", "PICKED_UP")).toBe(false);
    expect(canRestaurantMove("PREPARING", "CANCELLED")).toBe(false);
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
