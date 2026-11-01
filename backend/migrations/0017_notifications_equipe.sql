-- Notifications de l'équipe dans l'admin : fil des événements (30 jours) et réglages de chaque membre.
CREATE TABLE "StaffNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alarm" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "StaffNotification_category_createdAt_idx" ON "StaffNotification"("category", "createdAt");
CREATE INDEX "StaffNotification_createdAt_idx" ON "StaffNotification"("createdAt");

CREATE TABLE "StaffNotificationPrefs" (
    "subject" TEXT NOT NULL PRIMARY KEY,
    "muted" TEXT NOT NULL DEFAULT '[]',
    "seenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
