-- Livreurs salariés de Zedeka : salaire mensuel au lieu d'une part par course, et courses attribuées
-- d'office (pas de refus). Les livreurs existants restent indépendants.
ALTER TABLE "Driver" ADD COLUMN "employment" TEXT NOT NULL DEFAULT 'FREELANCE';
ALTER TABLE "Driver" ADD COLUMN "monthlySalary" INTEGER;
