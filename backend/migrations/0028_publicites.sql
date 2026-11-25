-- Publicités de l'accueil de l'appli client : bannières en carrousel sous « Livrer à », gérées dans l'admin
-- (image, lien facultatif, ordre, affichage oui/non, dates de début et de fin facultatives). Migration additive.
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "linkUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "Ad_active_position_idx" ON "Ad"("active", "position");
