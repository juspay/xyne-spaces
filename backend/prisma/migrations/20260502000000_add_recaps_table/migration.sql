-- Create RecapEntityType enum
CREATE TYPE "RecapEntityType" AS ENUM ('PROJECT', 'CHANNEL');

-- Create unified Recaps table for the Recap model
CREATE TABLE "recaps" (
    "id" TEXT NOT NULL,
    "entityType" "RecapEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "recapDate" TIMESTAMPTZ(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "userId" TEXT,

    CONSTRAINT "recaps_pkey" PRIMARY KEY ("id")
);

-- Create unique index
CREATE UNIQUE INDEX "recaps_entityType_entityId_userId_recapDate_key" ON "recaps"("entityType", "entityId", "userId", "recapDate");

-- Create index for performance
CREATE INDEX "recaps_entityId_idx" ON "recaps"("entityId");
CREATE INDEX "recaps_recapDate_idx" ON "recaps"("recapDate");
CREATE INDEX "recaps_userId_idx" ON "recaps"("userId");
CREATE INDEX "recaps_entityType_idx" ON "recaps"("entityType");