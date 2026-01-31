CREATE TABLE "failed_vespa_insertions" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "namespace" TEXT,
    "cluster" TEXT,
    "errorMessage" TEXT NOT NULL,
    "errorDetails" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "failed_vespa_insertions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "failed_vespa_insertions_entityId_idx" ON "failed_vespa_insertions"("entityId");

-- CreateIndex
CREATE INDEX "failed_vespa_insertions_entityType_idx" ON "failed_vespa_insertions"("entityType");

-- CreateIndex
CREATE INDEX "failed_vespa_insertions_userId_idx" ON "failed_vespa_insertions"("userId");

-- CreateIndex
CREATE INDEX "failed_vespa_insertions_entityId_entityType_idx" ON "failed_vespa_insertions"("entityId", "entityType");
