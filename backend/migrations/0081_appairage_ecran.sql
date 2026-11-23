-- Écran du bureau : appairage par code affiché à l'écran (additive).
CREATE TABLE "ScreenPairing" ("id" TEXT NOT NULL PRIMARY KEY,"code" TEXT NOT NULL,"tokenHash" TEXT NOT NULL,"screenId" TEXT,"key" TEXT,"createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,"expiresAt" DATETIME NOT NULL);
CREATE UNIQUE INDEX "ScreenPairing_code_key" ON "ScreenPairing"("code");
CREATE UNIQUE INDEX "ScreenPairing_tokenHash_key" ON "ScreenPairing"("tokenHash");
CREATE INDEX "ScreenPairing_expiresAt_idx" ON "ScreenPairing"("expiresAt");
