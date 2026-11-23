-- Écran technique (étape 1) : journal des erreurs, utilisateurs actifs du jour, relevés de l'écran technique.
-- Aucune donnée personnelle : erreurs regroupées par empreinte (route, code, message raccourci sans chiffres ni
-- adresses), appareils comptés par une empreinte à sens unique, relevés en simples nombres.
-- Migration additive : trois nouvelles tables et une colonne « kind » (valeur par défaut) sur les écrans, aucune donnée touchée.

-- Erreurs du serveur (5xx) et plantages d'écran sur les téléphones, par tranche de 5 minutes et par empreinte.
CREATE TABLE "ErrorEvent" (
    "bucket" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastAt" INTEGER NOT NULL,

    PRIMARY KEY ("bucket", "fingerprint")
);
CREATE INDEX "ErrorEvent_lastAt_idx" ON "ErrorEvent"("lastAt");

-- Appareils actifs par jour et par appli (empreinte de l'appareil, jamais son identifiant).
CREATE TABLE "ActiveDay" (
    "day" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "device" TEXT NOT NULL,

    PRIMARY KEY ("day", "app", "device")
);

-- Relevés de l'écran technique toutes les 5 minutes (ex. « online:client »), base des comparaisons et anomalies.
CREATE TABLE "TechSample" (
    "bucket" INTEGER NOT NULL,
    "metric" TEXT NOT NULL,
    "value" REAL NOT NULL,

    PRIMARY KEY ("bucket", "metric")
);

-- Type d'écran : OFFICE (écran du bureau, valeur des écrans existants) ou TECH (écran technique).
ALTER TABLE "DisplayScreen" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'OFFICE';
ALTER TABLE "ScreenPairing" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'OFFICE';
