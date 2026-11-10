-- Vitesse réelle vue par les téléphones des utilisateurs (Core Web Vitals) : une ligne par mesure, sans donnée
-- personnelle (page, mesure, valeur, type de réseau). Effacées après 30 jours. Uniquement des ajouts.
CREATE TABLE "WebVital" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "page" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "connection" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "WebVital_createdAt_idx" ON "WebVital"("createdAt");
CREATE INDEX "WebVital_name_page_createdAt_idx" ON "WebVital"("name", "page", "createdAt");
