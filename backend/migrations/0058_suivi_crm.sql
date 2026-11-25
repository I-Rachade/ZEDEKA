-- Suivi CRM dans l'admin (src/crm.ts, src/routes/adminCrm.ts) : notes de l'équipe, rappels et étiquettes posés sur
-- un livreur, un client, un commerce ou un marchand. entityType : DRIVER, CUSTOMER, RESTAURANT ou MERCHANT ;
-- entityId : id de la personne (pour un client : son numéro, pour suivre aussi les commandes passées sans compte).
-- Migration additive : trois tables seulement, aucune donnée touchée.

CREATE TABLE "CrmNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CrmNote_entityType_entityId_createdAt_idx" ON "CrmNote"("entityType", "entityId", "createdAt");
CREATE INDEX "CrmNote_kind_createdAt_idx" ON "CrmNote"("kind", "createdAt");

CREATE TABLE "CrmTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" DATETIME NOT NULL,
    "assignedTo" TEXT,
    "createdBy" TEXT NOT NULL,
    "doneAt" DATETIME,
    "doneBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CrmTask_doneAt_dueAt_idx" ON "CrmTask"("doneAt", "dueAt");
CREATE INDEX "CrmTask_entityType_entityId_idx" ON "CrmTask"("entityType", "entityId");

CREATE TABLE "CrmTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CrmTag_entityType_entityId_label_key" ON "CrmTag"("entityType", "entityId", "label");
CREATE INDEX "CrmTag_entityType_label_idx" ON "CrmTag"("entityType", "label");
