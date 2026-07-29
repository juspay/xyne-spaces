-- CreateEnum
CREATE TYPE "non_zero"."TeamIntelligenceBatchStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PARTIALLY_QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "non_zero"."TeamIntelligenceUserIngestionStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "non_zero"."TeamIntelligenceBulletCategory" AS ENUM ('SHIPPED', 'ACHIEVEMENT', 'COLLABORATION', 'LEARNING', 'RECOGNITION', 'LEARNED', 'HELPED', 'MILESTONE');

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_ingestion_batches" (
    "id" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestChecksum" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "queuedUsers" INTEGER NOT NULL DEFAULT 0,
    "failedUsers" INTEGER NOT NULL DEFAULT 0,
    "status" "non_zero"."TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_ingestion_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_user_ingestions" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "teamId" TEXT,
    "teamName" TEXT,
    "rawPayload" JSONB NOT NULL,
    "pullRequests" JSONB NOT NULL,
    "soloCommits" JSONB NOT NULL,
    "aiUsage" JSONB,
    "employeeSummary" JSONB,
    "summaryMetadata" JSONB,
    "processingStatus" "non_zero"."TeamIntelligenceUserIngestionStatus" NOT NULL DEFAULT 'RECEIVED',
    "queueJobId" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_user_ingestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_team_summaries" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "teamId" TEXT,
    "teamName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "completedUsers" INTEGER NOT NULL DEFAULT 0,
    "failedUsers" INTEGER NOT NULL DEFAULT 0,
    "summaryText" JSONB,
    "summaryMetadata" JSONB,
    "provenance" JSONB,
    "status" "non_zero"."TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "queueJobId" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_team_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."team_intelligence_org_summaries" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalTeams" INTEGER NOT NULL,
    "completedTeams" INTEGER NOT NULL DEFAULT 0,
    "failedTeams" INTEGER NOT NULL DEFAULT 0,
    "summaryText" JSONB,
    "summaryMetadata" JSONB,
    "provenance" JSONB,
    "status" "non_zero"."TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "queueJobId" TEXT,
    "queuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_org_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_ingestion_batches_idempotencyKey_key" ON "non_zero"."team_intelligence_ingestion_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_reportDate_idx" ON "non_zero"."team_intelligence_ingestion_batches"("reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_source_reportDate_idx" ON "non_zero"."team_intelligence_ingestion_batches"("source", "reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_status_receivedAt_idx" ON "non_zero"."team_intelligence_ingestion_batches"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_user_ingestions_batchId_userEmail_key" ON "non_zero"."team_intelligence_user_ingestions"("batchId", "userEmail");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_reportDate_userEmail_idx" ON "non_zero"."team_intelligence_user_ingestions"("reportDate", "userEmail");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_batchId_processingStatus_idx" ON "non_zero"."team_intelligence_user_ingestions"("batchId", "processingStatus");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_source_reportDate_idx" ON "non_zero"."team_intelligence_user_ingestions"("source", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_team_summaries_idempotencyKey_key" ON "non_zero"."team_intelligence_team_summaries"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_team_summaries_batchId_teamId_teamName_key" ON "non_zero"."team_intelligence_team_summaries"("batchId", "teamId", "teamName");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_reportDate_teamId_teamName_idx" ON "non_zero"."team_intelligence_team_summaries"("reportDate", "teamId", "teamName");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_batchId_status_idx" ON "non_zero"."team_intelligence_team_summaries"("batchId", "status");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_source_reportDate_idx" ON "non_zero"."team_intelligence_team_summaries"("source", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_org_summaries_batchId_key" ON "non_zero"."team_intelligence_org_summaries"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_org_summaries_idempotencyKey_key" ON "non_zero"."team_intelligence_org_summaries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_reportDate_idx" ON "non_zero"."team_intelligence_org_summaries"("reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_source_reportDate_idx" ON "non_zero"."team_intelligence_org_summaries"("source", "reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_status_createdAt_idx" ON "non_zero"."team_intelligence_org_summaries"("status", "createdAt");
