-- Modules du bouton « Services » de l'appli client : état (ON, SOON, OFF) et ordre choisis dans l'admin.
-- Table neuve : aucune donnée existante n'est touchée. Sans ligne, chaque module garde son état par défaut.
CREATE TABLE "ServiceModule" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL DEFAULT 'OFF',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT
);
