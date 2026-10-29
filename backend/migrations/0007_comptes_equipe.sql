-- Comptes de l'équipe Zedeka pour l'admin (directeur ou dispatcheur), et nom de qui a attribué chaque course.
-- Le mot de passe ADMIN_PASSWORD reste valable : il ouvre l'admin en tant que directeur des opérations.
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DISPATCHER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "TeamMember_email_key" ON "TeamMember"("email");

ALTER TABLE "DriverAssignment" ADD COLUMN "assignedBy" TEXT;
