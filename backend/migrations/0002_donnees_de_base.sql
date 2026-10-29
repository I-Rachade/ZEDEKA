-- Données de base de la production : sans types de colis ni zones, le formulaire « Envoyer un colis »
-- ne peut pas être rempli. Mêmes valeurs que prisma/seed.ts, modifiables ensuite dans l'admin.
-- INSERT OR IGNORE sur le nom (unique) : sans effet sur une base qui les a déjà.
INSERT OR IGNORE INTO "ParcelCategory" ("id", "name", "surcharge", "perKgFee") VALUES
    (lower(hex(randomblob(12))), 'Documents', 0, 0),
    (lower(hex(randomblob(12))), 'Petit colis (moins de 5 kg)', 250, 0),
    (lower(hex(randomblob(12))), 'Gros colis', 500, 100),
    (lower(hex(randomblob(12))), 'Fragile', 750, 50);

INSERT OR IGNORE INTO "Zone" ("id", "name", "deliveryFee") VALUES
    (lower(hex(randomblob(12))), 'Zone 1 – Centre (Tokoin, Bè, Nyékonakpoè)', 1000),
    (lower(hex(randomblob(12))), 'Zone 2 – Agoè, Adidogomé, Baguida', 1500),
    (lower(hex(randomblob(12))), 'Zone 3 – Périphérie', 2000);
