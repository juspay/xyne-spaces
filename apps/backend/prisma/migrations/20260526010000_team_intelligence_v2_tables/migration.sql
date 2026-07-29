-- Team Intelligence V2 parallel tables (no backfill, no mutation of existing tables)

CREATE TABLE "non_zero"."team_intelligence_ingestion_batches_v2" (
  "id" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestChecksum" TEXT NOT NULL,
  "requestPayload" JSONB,
  "contentUrl" TEXT,
  "contentSize" INTEGER,
  "contentChecksum" TEXT,
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

  CONSTRAINT "team_intelligence_ingestion_batches_v2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "non_zero"."team_intelligence_user_ingestions_v2" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "userEmail" TEXT NOT NULL,
  "userName" TEXT NOT NULL,
  "teamId" TEXT,
  "teamName" TEXT,
  "aiUsage" JSONB,
  "contentUrl" TEXT,
  "contentSize" INTEGER,
  "contentChecksum" TEXT,
  "processingStatus" "non_zero"."TeamIntelligenceUserIngestionStatus" NOT NULL DEFAULT 'RECEIVED',
  "queueJobId" TEXT,
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_intelligence_user_ingestions_v2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "non_zero"."team_intelligence_team_summaries_v2" (
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
  "contentUrl" TEXT,
  "contentSize" INTEGER,
  "contentChecksum" TEXT,
  "status" "non_zero"."TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
  "queueJobId" TEXT,
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_intelligence_team_summaries_v2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "non_zero"."team_intelligence_org_summaries_v2" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "reportDate" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "totalTeams" INTEGER NOT NULL,
  "completedTeams" INTEGER NOT NULL DEFAULT 0,
  "failedTeams" INTEGER NOT NULL DEFAULT 0,
  "contentUrl" TEXT,
  "contentSize" INTEGER,
  "contentChecksum" TEXT,
  "status" "non_zero"."TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
  "queueJobId" TEXT,
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "team_intelligence_org_summaries_v2_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_intelligence_ingestion_batches_v2_idempotencyKey_key"
  ON "non_zero"."team_intelligence_ingestion_batches_v2"("idempotencyKey");

CREATE INDEX "team_intelligence_ingestion_batches_v2_reportDate_idx"
  ON "non_zero"."team_intelligence_ingestion_batches_v2"("reportDate");

CREATE INDEX "team_intelligence_ingestion_batches_v2_source_reportDate_idx"
  ON "non_zero"."team_intelligence_ingestion_batches_v2"("source", "reportDate");

CREATE INDEX "team_intelligence_ingestion_batches_v2_status_receivedAt_idx"
  ON "non_zero"."team_intelligence_ingestion_batches_v2"("status", "receivedAt");

CREATE INDEX "team_intelligence_ingestion_batches_v2_content_url_idx"
  ON "non_zero"."team_intelligence_ingestion_batches_v2"("contentUrl");

CREATE UNIQUE INDEX "team_intelligence_user_ingestions_v2_batchId_userEmail_key"
  ON "non_zero"."team_intelligence_user_ingestions_v2"("batchId", "userEmail");

CREATE INDEX "team_intelligence_user_ingestions_v2_reportDate_userEmail_idx"
  ON "non_zero"."team_intelligence_user_ingestions_v2"("reportDate", "userEmail");

CREATE INDEX "team_intelligence_user_ingestions_v2_batchId_processingStatus_idx"
  ON "non_zero"."team_intelligence_user_ingestions_v2"("batchId", "processingStatus");

CREATE INDEX "team_intelligence_user_ingestions_v2_source_reportDate_idx"
  ON "non_zero"."team_intelligence_user_ingestions_v2"("source", "reportDate");

CREATE INDEX "team_intelligence_user_ingestions_v2_content_url_idx"
  ON "non_zero"."team_intelligence_user_ingestions_v2"("contentUrl");

CREATE UNIQUE INDEX "team_intelligence_team_summaries_v2_idempotencyKey_key"
  ON "non_zero"."team_intelligence_team_summaries_v2"("idempotencyKey");

CREATE UNIQUE INDEX "team_intelligence_team_summaries_v2_batchId_teamId_key"
  ON "non_zero"."team_intelligence_team_summaries_v2"("batchId", "teamId");

CREATE INDEX "team_intelligence_team_summaries_v2_reportDate_teamId_idx"
  ON "non_zero"."team_intelligence_team_summaries_v2"("reportDate", "teamId");

CREATE INDEX "team_intelligence_team_summaries_v2_batchId_status_idx"
  ON "non_zero"."team_intelligence_team_summaries_v2"("batchId", "status");

CREATE INDEX "team_intelligence_team_summaries_v2_source_reportDate_idx"
  ON "non_zero"."team_intelligence_team_summaries_v2"("source", "reportDate");

CREATE INDEX "team_intelligence_team_summaries_v2_content_url_idx"
  ON "non_zero"."team_intelligence_team_summaries_v2"("contentUrl");

CREATE UNIQUE INDEX "team_intelligence_org_summaries_v2_batchId_key"
  ON "non_zero"."team_intelligence_org_summaries_v2"("batchId");

CREATE UNIQUE INDEX "team_intelligence_org_summaries_v2_idempotencyKey_key"
  ON "non_zero"."team_intelligence_org_summaries_v2"("idempotencyKey");

CREATE INDEX "team_intelligence_org_summaries_v2_reportDate_idx"
  ON "non_zero"."team_intelligence_org_summaries_v2"("reportDate");

CREATE INDEX "team_intelligence_org_summaries_v2_source_reportDate_idx"
  ON "non_zero"."team_intelligence_org_summaries_v2"("source", "reportDate");

CREATE INDEX "team_intelligence_org_summaries_v2_status_createdAt_idx"
  ON "non_zero"."team_intelligence_org_summaries_v2"("status", "createdAt");

CREATE INDEX "team_intelligence_org_summaries_v2_content_url_idx"
  ON "non_zero"."team_intelligence_org_summaries_v2"("contentUrl");

