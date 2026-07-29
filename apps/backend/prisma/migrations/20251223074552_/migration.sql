-- Drop table if exists
DROP TABLE IF EXISTS "failed_vespa_insertions";


-- CreateEnum
CREATE TYPE "VespaInsertionStatus" AS ENUM ('PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "VespaOperationType" AS ENUM ('INSERT', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "vespa_insertion_logs" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "type" "VespaOperationType" NOT NULL,
    "status" "VespaInsertionStatus" NOT NULL DEFAULT 'PENDING',
    "namespace" TEXT,
    "cluster" TEXT,
    "errorMessage" TEXT,
    "errorDetails" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "vespa_insertion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_entityId_idx" ON "vespa_insertion_logs"("entityId");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_entityType_idx" ON "vespa_insertion_logs"("entityType");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_userId_idx" ON "vespa_insertion_logs"("userId");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_status_idx" ON "vespa_insertion_logs"("status");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_type_idx" ON "vespa_insertion_logs"("type");

-- CreateIndex
CREATE INDEX "vespa_insertion_logs_entityId_entityType_idx" ON "vespa_insertion_logs"("entityId", "entityType");