import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Données de démonstration pour le pilote à Lomé. Tarifs de zone à confirmer.
const zones = [
  { name: "Zone 1 – Centre (Tokoin, Bè, Nyékonakpoè)", deliveryFee: 1000 },
  { name: "Zone 2 – Agoè, Adidogomé, Baguida", deliveryFee: 1500 },
  { name: "Zone 3 – Périphérie", deliveryFee: 2000 },
];

const parcelCategories = [
  { name: "Documents", surcharge: 0, perKgFee: 0 },
  { name: "Petit colis (moins de 5 kg)", surcharge: 250, perKgFee: 0 },
  { name: "Gros colis", surcharge: 500, perKgFee: 100 },
  { name: "Fragile", surcharge: 750, perKgFee: 50 },
];

const restaurants = [
  {
    slug: "chez-tante-ama",
    name: "Chez Tante Ama",
    phone: "22890000001",
    address: "Tokoin, Lomé",
    latitude: 6.1475,
    longitude: 1.2125,
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
    latitude: 6.1319,
    longitude: 1.2386,
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
  for (const c of parcelCategories) {
    await prisma.parcelCategory.upsert({ where: { name: c.name }, update: c, create: c });
  }
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const centre = await prisma.zone.findUniqueOrThrow({ where: { name: zones[0].name } });
  for (const { menu, ...r } of restaurants) {
    // Accès de démonstration à l'espace restaurant : <slug>@demo.zedeka.tg / zedeka-demo
    const data = {
      ...r,
      zoneId: centre.id,
      ownerEmail: `${r.slug}@demo.zedeka.tg`,
      ownerPasswordHash: await bcrypt.hash("zedeka-demo", 10),
    };
    const restaurant = await prisma.restaurant.upsert({ where: { slug: r.slug }, update: data, create: data });
    const existing = await prisma.menuItem.count({ where: { restaurantId: restaurant.id } });
    if (existing === 0) {
      await prisma.menuItem.createMany({
        data: menu.map((m, i) => ({ ...m, sortOrder: i, restaurantId: restaurant.id })),
      });
      // Exemple de variantes et de suppléments sur le premier plat.
      const first = await prisma.menuItem.findFirstOrThrow({ where: { restaurantId: restaurant.id }, orderBy: { sortOrder: "asc" } });
      await prisma.menuVariant.createMany({
        data: [
          { menuItemId: first.id, name: "Portion normale", price: first.price, sortOrder: 0 },
          { menuItemId: first.id, name: "Grande portion", price: first.price + 1000, sortOrder: 1 },
        ],
      });
      const egg = await prisma.addon.create({ data: { restaurantId: restaurant.id, name: "Œuf", price: 200 } });
      const pepper = await prisma.addon.create({ data: { restaurantId: restaurant.id, name: "Piment", price: 100 } });
      await prisma.menuItem.update({ where: { id: first.id }, data: { addons: { connect: [{ id: egg.id }, { id: pepper.id }] } } });
    }
  }
  // Loueur de démonstration : lome-auto@demo.zedeka.tg / zedeka-demo
  const rental = {
    slug: "lome-auto",
    name: "Lomé Auto Location",
    phone: "22890000010",
    address: "Boulevard du 13 Janvier, Lomé",
    pickupZoneId: centre.id,
    ownerEmail: "lome-auto@demo.zedeka.tg",
    ownerPasswordHash: await bcrypt.hash("zedeka-demo", 10),
  };
  const provider = await prisma.rentalProvider.upsert({ where: { slug: rental.slug }, update: rental, create: rental });
  if ((await prisma.vehicle.count({ where: { providerId: provider.id } })) === 0) {
    await prisma.vehicle.create({
      data: {
        providerId: provider.id,
        name: "Toyota Corolla",
        description: "Berline climatisée, idéale en ville.",
        brand: "Toyota",
        model: "Corolla",
        category: "Berline",
        type: "Standard",
        seats: 5,
        fuel: "Essence",
        transmission: "Automatique",
        hourlyPrice: 5000,
        dailyPrice: 35000,
        perKmPrice: 400,
        discountPercent: 5,
        units: { create: [{ plateNumber: "TG-1234-AB" }, { plateNumber: "TG-5678-AB" }] },
      },
    });
    await prisma.vehicle.create({
      data: {
        providerId: provider.id,
        name: "Toyota Hiace",
        description: "Minibus 14 places pour les groupes et les mariages.",
        brand: "Toyota",
        model: "Hiace",
        category: "Minibus",
        type: "Confort",
        seats: 14,
        fuel: "Diesel",
        transmission: "Manuelle",
        dailyPrice: 75000,
        units: { create: [{ plateNumber: "TG-9012-AC" }] },
      },
    });
    await prisma.rentalDriver.createMany({
      data: [
        { providerId: provider.id, firstName: "Komi", lastName: "Agbeko", phone: "90 11 22 33", idType: "Permis", idNumber: "TG-P-445566" },
        { providerId: provider.id, firstName: "Yao", lastName: "Mensah", phone: "91 44 55 66", idType: "CNI", idNumber: "0123456789" },
      ],
    });
  }
  console.log("Données de démonstration chargées.");
}

main().finally(() => prisma.$disconnect());
