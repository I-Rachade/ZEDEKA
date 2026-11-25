-- Notes des restaurants (accueil, carte) : moyenne et nombre d'avis lus dans un index qui ne contient que les
-- commandes notées, au lieu de parcourir toute la table des commandes. Uniquement un ajout.
CREATE INDEX IF NOT EXISTS "Order_restaurantId_restaurantRating_rated_idx"
  ON "Order"("restaurantId", "restaurantRating") WHERE "restaurantRating" IS NOT NULL;
