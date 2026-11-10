// Tuiles « Catégories » de l'accueil et de la recherche (mêmes clés que backend/src/cuisines.ts).
// image : vraie photo de plat pour les ronds de l'accueil (public/categories/<clé>.webp, carrée 256 × 256,
// moins de 30 Ko, plat centré, sans texte ni logo). Sans image, l'emoji reste affiché.
export const CUISINES: { key: string; label: string; emoji: string; image?: string }[] = [
  { key: "poulet", label: "Poulet", emoji: "🍗", image: "/categories/poulet.webp" },
  { key: "pizza", label: "Pizza", emoji: "🍕" },
  { key: "local", label: "Local", emoji: "🥘", image: "/categories/local.webp" },
  { key: "burger", label: "Burgers", emoji: "🍔" },
  { key: "grillade", label: "Grillades", emoji: "🔥", image: "/categories/grillade.webp" },
  { key: "poisson", label: "Poisson", emoji: "🐟", image: "/categories/poisson.webp" },
  { key: "riz", label: "Riz", emoji: "🍚", image: "/categories/riz.webp" },
  { key: "sandwich", label: "Sandwichs", emoji: "🥪" },
  { key: "dessert", label: "Desserts", emoji: "🍰" },
  { key: "boisson", label: "Boissons", emoji: "🥤" },
];
