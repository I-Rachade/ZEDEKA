import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Données de démonstration pour le pilote à Lomé. Tarifs de zone à confirmer.
const zones = [
  { name: "Zone 1 – Centre (Tokoin, Bè, Nyékonakpoè)", deliveryFee: 1000 },
  { name: "Zone 2 – Agoè, Adidogomé, Baguida", deliveryFee: 1500 },
  { name: "Zone 3 – Périphérie", deliveryFee: 2000 },
];

const restaurants = [
  {
    slug: "chez-tante-ama",
    name: "Chez Tante Ama",
    phone: "22890000001",
    address: "Tokoin, Lomé",
    menu: [
      { category: "Plats", name: "Riz sauce arachide au poulet", price: 2500 },
      { category: "Plats", name: "Pâte rouge et poisson braisé", price: 3000 },
      { category: "Plats", name: "Fufu sauce graine", price: 2000 },
      { category: "Boissons", name: "Jus de bissap", price: 500 },
      { category: "Boissons", name: "Eau minérale 1,5 L", price: 600 },
    ],
  },
  {
    slug: "le-maquis-du-port",
    name: "Le Maquis du Port",
    phone: "22890000002",
    address: "Bè, Lomé",
    menu: [
      { category: "Grillades", name: "Poulet bicyclette braisé", price: 4000 },
      { category: "Grillades", name: "Brochettes de bœuf (x4)", price: 2000 },
      { category: "Accompagnements", name: "Alloco", price: 1000 },
      { category: "Accompagnements", name: "Attiéké", price: 800 },
      { category: "Boissons", name: "Jus de gingembre", price: 500 },
    ],
  },
];

async function main() {
  for (const z of zones) {
    await prisma.zone.upsert({ where: { name: z.name }, update: { deliveryFee: z.deliveryFee }, create: z });
  }
  for (const { menu, ...r } of restaurants) {
    const restaurant = await prisma.restaurant.upsert({ where: { slug: r.slug }, update: r, create: r });
    const existing = await prisma.menuItem.count({ where: { restaurantId: restaurant.id } });
    if (existing === 0) {
      await prisma.menuItem.createMany({
        data: menu.map((m, i) => ({ ...m, sortOrder: i, restaurantId: restaurant.id })),
      });
    }
  }
  console.log("Données de démonstration chargées.");
}

main().finally(() => prisma.$disconnect());
