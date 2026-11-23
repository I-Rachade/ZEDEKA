-- Ressources humaines et comptabilité dans l'admin (src/hr.ts, src/accounting.ts, src/routes/adminHr.ts,
-- src/routes/adminAccounting.ts), avec deux nouveaux rôles de l'équipe : HR (ressources humaines) et ACCOUNTANT
-- (comptable). Les rôles sont du texte dans TeamMember.role : aucune colonne à changer.
-- Migration additive : six tables nouvelles, aucune donnée touchée.

-- Fiche d'un employé de Zedeka (bureau, terrain, livreurs salariés). driverId : fiche liée à un livreur salarié.
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "position" TEXT NOT NULL,
    "department" TEXT,
    "contractType" TEXT NOT NULL DEFAULT 'CDI',
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "trialEndDate" DATETIME,
    "monthlySalary" INTEGER NOT NULL DEFAULT 0,
    "paymentMethod" TEXT NOT NULL DEFAULT 'MOBILE_MONEY',
    "paymentAccount" TEXT,
    "birthDate" DATETIME,
    "address" TEXT,
    "idNumber" TEXT,
    "cnssNumber" TEXT,
    "emergencyContact" TEXT,
    "leaveDaysPerYear" INTEGER NOT NULL DEFAULT 30,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "leftAt" DATETIME,
    "leftReason" TEXT,
    "notes" TEXT,
    "driverId" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Employee_driverId_key" ON "Employee"("driverId");
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- Congés et absences : demandés, puis acceptés ou refusés par les ressources humaines.
CREATE TABLE "EmployeeLeave" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "days" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "reason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" DATETIME,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeLeave_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EmployeeLeave_employeeId_startDate_idx" ON "EmployeeLeave"("employeeId", "startDate");
CREATE INDEX "EmployeeLeave_status_idx" ON "EmployeeLeave"("status");

-- Documents d'un employé (contrat signé, pièce d'identité, diplômes…), rangés dans R2.
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");

-- Bulletin de paie d'un mois (AAAA-MM) : préparé et validé par les RH, payé par le comptable.
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "baseSalary" INTEGER NOT NULL,
    "unpaidDays" INTEGER NOT NULL DEFAULT 0,
    "absenceDeduction" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "validatedBy" TEXT,
    "validatedAt" DATETIME,
    "paidAt" DATETIME,
    "paidBy" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payslip_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Payslip_employeeId_month_key" ON "Payslip"("employeeId", "month");
CREATE INDEX "Payslip_month_status_idx" ON "Payslip"("month", "status");

-- Comptes de trésorerie de Zedeka : caisse, mobile money, banque.
CREATE TABLE "FinanceAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "number" TEXT,
    "openingBalance" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Journal des recettes et des dépenses. Une écriture n'est jamais effacée : elle est annulée (voidedAt), avec le motif.
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "direction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "accountId" TEXT,
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "counterparty" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" DATETIME,
    "voidedBy" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinanceAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "LedgerEntry_date_idx" ON "LedgerEntry"("date");
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");
CREATE INDEX "LedgerEntry_source_sourceId_idx" ON "LedgerEntry"("source", "sourceId");
