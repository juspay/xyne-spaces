-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "common";

-- CreateTable
CREATE TABLE "common"."entity_sequences" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityValue" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_sequences_entityType_entityValue_key" ON "common"."entity_sequences"("entityType", "entityValue");
