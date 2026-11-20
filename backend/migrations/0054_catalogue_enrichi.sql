-- Catalogue enrichi : plusieurs photos, groupes de choix (« Sauce : arachide ou tomate ») et stock facultatif par plat.
-- Migration additive : trois nouvelles colonnes. Aucune donnée existante touchée.

ALTER TABLE "MenuItem" ADD COLUMN "imageUrls" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MenuItem" ADD COLUMN "options" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MenuItem" ADD COLUMN "stock" INTEGER;
