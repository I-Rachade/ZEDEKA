import { fold } from "./customer.js";

// Tuiles « Catégories » de l'accueil client : un restaurant y figure si un plat ou une rubrique de sa carte
// contient l'un des mots-clés. Rien à saisir dans l'admin : la carte suffit.
export const CUISINES: { key: string; label: string; emoji: string; words: string[] }[] = [
  { key: "poulet", label: "Poulet", emoji: "🍗", words: ["poulet", "chicken", "pintade", "aile"] },
  { key: "pizza", label: "Pizza", emoji: "🍕", words: ["pizza"] },
  { key: "local", label: "Local", emoji: "🥘", words: ["akoume", "pate", "fufu", "foufou", "ablo", "gboma", "ademe", "riz sauce", "sauce", "attieke", "koliko", "kom", "abobo", "ayimolou", "djinkoume"] },
  { key: "burger", label: "Burgers", emoji: "🍔", words: ["burger", "hamburger", "cheese"] },
  { key: "grillade", label: "Grillades", emoji: "🔥", words: ["grill", "braise", "brochette", "choukouya", "barbecue"] },
  { key: "poisson", label: "Poisson", emoji: "🐟", words: ["poisson", "tilapia", "carpe", "capitaine", "crevette", "fruits de mer"] },
  { key: "riz", label: "Riz", emoji: "🍚", words: ["riz"] },
  { key: "sandwich", label: "Sandwichs", emoji: "🥪", words: ["sandwich", "shawarma", "chawarma", "tacos", "panini", "wrap"] },
  { key: "dessert", label: "Desserts", emoji: "🍰", words: ["dessert", "gateau", "glace", "crepe", "beignet", "patisserie"] },
  { key: "boisson", label: "Boissons", emoji: "🥤", words: ["boisson", "jus", "bissap", "soda", "cafe", "the ", "smoothie", "cocktail"] },
];

export function cuisinesOf(items: { name: string; category: string }[]): string[] {
  const text = ` ${items.map((m) => `${fold(m.name)} ${fold(m.category)}`).join(" ")} `;
  return CUISINES.filter((c) => c.words.some((w) => text.includes(w))).map((c) => c.key);
}
