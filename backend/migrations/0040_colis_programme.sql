-- Colis à récupérer plus tard : jour et heure du retrait choisis par l'expéditeur (jusqu'à 7 jours). La répartition
-- automatique ne le propose aux livreurs qu'à partir de 30 minutes avant ; l'équipe le voit avec son heure.
-- Migration additive : une colonne.
ALTER TABLE "Order" ADD COLUMN "pickupAt" DATETIME;
