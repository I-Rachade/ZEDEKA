-- Position d'un restaurant demandée à son gérant par un lien (même mécanisme que pour les colis et les repas).
ALTER TABLE "LocationRequest" ADD COLUMN "restaurantId" TEXT REFERENCES "Restaurant" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "LocationRequest_restaurantId_key" ON "LocationRequest"("restaurantId");
