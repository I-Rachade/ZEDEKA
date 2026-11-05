import { describe, expect, it } from "vitest";
import { cuisinesOf } from "./cuisines.js";

// Tuiles de l'accueil déduites de la carte : rien à saisir pour le restaurant.
describe("catégories d'un restaurant", () => {
  it("se lisent dans les plats et les rubriques, sans accents ni majuscules", () => {
    expect(cuisinesOf([{ name: "Poulet braisé entier", category: "Populaires" }, { name: "Alloco", category: "Accompagnements" }])).toEqual(["poulet", "grillade"]);
    expect(cuisinesOf([{ name: "Brochettes", category: "Grillades" }, { name: "Jus de bissap", category: "Boissons" }])).toEqual(["grillade", "boisson"]);
    expect(cuisinesOf([{ name: "Fufu sauce graine", category: "Plats" }, { name: "Pizza 4 saisons", category: "Pizzas" }])).toEqual(["pizza", "local"]);
    expect(cuisinesOf([{ name: "Salade", category: "Entrées" }])).toEqual([]);
  });
});
