-- Mode Zed (moto-taxi) : un conducteur Zed s'inscrit lui-même, l'équipe vérifie ses pièces, il paie son plan Zed
-- (mois ou jour, premier mois offert) et reçoit les appels des clients dans 1 km, 15 s pour accepter, puis le
-- suivant. Le prix se fait sur place. Migration additive : nouvelles colonnes et tables seulement.

-- Métiers du compte : un conducteur Zed inscrit seul ne fait pas de livraisons (deliveries = false).
ALTER TABLE "Driver" ADD COLUMN "deliveries" BOOLEAN NOT NULL DEFAULT true;
-- NULL : pas inscrit au mode Zed ; PENDING : pièces à vérifier ; ACTIVE ; REJECTED ; SUSPENDED.
ALTER TABLE "Driver" ADD COLUMN "zedStatus" TEXT;
ALTER TABLE "Driver" ADD COLUMN "zedAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Driver" ADD COLUMN "plate" TEXT;
ALTER TABLE "Driver" ADD COLUMN "zedAppliedAt" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "zedReviewedAt" DATETIME;
ALTER TABLE "Driver" ADD COLUMN "zedReviewedBy" TEXT;
ALTER TABLE "Driver" ADD COLUMN "zedNote" TEXT;
-- Propositions Zed laissées sans réponse d'affilée (3 : le conducteur n'est plus disponible).
ALTER TABLE "Driver" ADD COLUMN "zedMissed" INTEGER NOT NULL DEFAULT 0;

-- Photos du dossier (R2, jamais publiques) : SELFIE, ID_CARD, LICENCE, MOTO.
CREATE TABLE "ZedDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZedDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ZedDocument_driverId_kind_key" ON "ZedDocument"("driverId", "kind");

-- Paiements du plan Zed : essai offert, mois ou jour, payé par mobile money (référence) et confirmé par l'équipe.
CREATE TABLE "ZedPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZedPayment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ZedPayment_reference_key" ON "ZedPayment"("reference");
CREATE INDEX "ZedPayment_driverId_status_idx" ON "ZedPayment"("driverId", "status");
CREATE INDEX "ZedPayment_status_createdAt_idx" ON "ZedPayment"("status", "createdAt");

-- Course Zed : position du client, conducteur retenu, étapes, prix noté et note du client.
CREATE TABLE "ZedRide" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "accuracy" REAL,
    "landmark" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SEARCHING',
    "driverId" TEXT,
    "acceptedAt" DATETIME,
    "onboardAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "price" INTEGER,
    "rating" INTEGER,
    "ratingComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZedRide_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ZedRide_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ZedRide_code_key" ON "ZedRide"("code");
CREATE INDEX "ZedRide_status_createdAt_idx" ON "ZedRide"("status", "createdAt");
CREATE INDEX "ZedRide_customerId_createdAt_idx" ON "ZedRide"("customerId", "createdAt");
CREATE INDEX "ZedRide_driverId_status_idx" ON "ZedRide"("driverId", "status");

-- Chaque alerte envoyée à un conducteur pour une course, et sa réponse.
CREATE TABLE "ZedOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rideId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" DATETIME,
    CONSTRAINT "ZedOffer_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "ZedRide" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ZedOffer_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ZedOffer_rideId_idx" ON "ZedOffer"("rideId");
CREATE INDEX "ZedOffer_driverId_status_idx" ON "ZedOffer"("driverId", "status");
CREATE INDEX "ZedOffer_status_sentAt_idx" ON "ZedOffer"("status", "sentAt");

-- Réglages du mode Zed (désactivé tant que l'équipe ne l'ouvre pas aux clients).
ALTER TABLE "Settings" ADD COLUMN "zedEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Settings" ADD COLUMN "zedRadiusM" INTEGER NOT NULL DEFAULT 1000;
ALTER TABLE "Settings" ADD COLUMN "zedOfferSeconds" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "Settings" ADD COLUMN "zedMaxOffers" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Settings" ADD COLUMN "zedMonthPrice" INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE "Settings" ADD COLUMN "zedDayPrice" INTEGER NOT NULL DEFAULT 500;
ALTER TABLE "Settings" ADD COLUMN "zedTrialDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "Settings" ADD COLUMN "zedPaymentNumber" TEXT NOT NULL DEFAULT '';
