-- Suivi de la performance de l'API (src/apiMetrics.ts) : par tranche de 5 minutes et par route, nombre de requêtes,
-- erreurs, temps cumulé, plus long temps et répartition des temps de réponse. Aucune donnée personnelle (ni compte,
-- ni adresse IP, ni identifiant dans la route : « /api/orders/:code »). Le cron écrit aussi un battement par minute
-- (route « cron »), qui sert au calcul de la disponibilité.
-- Migration additive : une nouvelle table, aucune donnée touchée.

CREATE TABLE "ApiMetric" (
    "bucket" INTEGER NOT NULL,
    "route" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "clientErrors" INTEGER NOT NULL DEFAULT 0,
    "totalMs" INTEGER NOT NULL DEFAULT 0,
    "maxMs" INTEGER NOT NULL DEFAULT 0,
    "h50" INTEGER NOT NULL DEFAULT 0,
    "h100" INTEGER NOT NULL DEFAULT 0,
    "h200" INTEGER NOT NULL DEFAULT 0,
    "h500" INTEGER NOT NULL DEFAULT 0,
    "h1000" INTEGER NOT NULL DEFAULT 0,
    "h2000" INTEGER NOT NULL DEFAULT 0,
    "h5000" INTEGER NOT NULL DEFAULT 0,
    "hMore" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("bucket", "route")
);
