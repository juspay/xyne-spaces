-- CreateEnum
CREATE TYPE "TeamIntelligenceBatchStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PARTIALLY_QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "TeamIntelligenceUserIngestionStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "team_intelligence_ingestion_batches" (
    "id" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestChecksum" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "queuedUsers" INTEGER NOT NULL DEFAULT 0,
    "failedUsers" INTEGER NOT NULL DEFAULT 0,
    "status" "TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_intelligence_ingestion_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_intelligence_user_ingestions" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "teamName" TEXT,
    "rawPayload" JSONB NOT NULL,
    "pullRequests" JSONB NOT NULL,
    "soloCommits" JSONB NOT NULL,
    "aiUsage" JSONB,
    "employeeSummary" JSONB,
    "summaryMetadata" JSONB,
    "processingStatus" "TeamIntelligenceUserIngestionStatus" NOT NULL DEFAULT 'RECEIVED',
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
CREATE TABLE "team_intelligence_team_summaries" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "totalUsers" INTEGER NOT NULL,
    "completedUsers" INTEGER NOT NULL DEFAULT 0,
    "failedUsers" INTEGER NOT NULL DEFAULT 0,
    "summaryText" JSONB,
    "summaryMetadata" JSONB,
    "provenance" JSONB,
    "status" "TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
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
CREATE TABLE "team_intelligence_org_summaries" (
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
    "status" "TeamIntelligenceBatchStatus" NOT NULL DEFAULT 'RECEIVED',
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
CREATE UNIQUE INDEX "team_intelligence_ingestion_batches_idempotencyKey_key" ON "team_intelligence_ingestion_batches"("idempotencyKey");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_reportDate_idx" ON "team_intelligence_ingestion_batches"("reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_source_reportDate_idx" ON "team_intelligence_ingestion_batches"("source", "reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_ingestion_batches_status_receivedAt_idx" ON "team_intelligence_ingestion_batches"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_user_ingestions_batchId_userEmail_key" ON "team_intelligence_user_ingestions"("batchId", "userEmail");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_reportDate_userEmail_idx" ON "team_intelligence_user_ingestions"("reportDate", "userEmail");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_batchId_processingStatus_idx" ON "team_intelligence_user_ingestions"("batchId", "processingStatus");

-- CreateIndex
CREATE INDEX "team_intelligence_user_ingestions_source_reportDate_idx" ON "team_intelligence_user_ingestions"("source", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_team_summaries_idempotencyKey_key" ON "team_intelligence_team_summaries"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_team_summaries_batchId_teamName_key" ON "team_intelligence_team_summaries"("batchId", "teamName");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_reportDate_teamName_idx" ON "team_intelligence_team_summaries"("reportDate", "teamName");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_batchId_status_idx" ON "team_intelligence_team_summaries"("batchId", "status");

-- CreateIndex
CREATE INDEX "team_intelligence_team_summaries_source_reportDate_idx" ON "team_intelligence_team_summaries"("source", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_org_summaries_batchId_key" ON "team_intelligence_org_summaries"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "team_intelligence_org_summaries_idempotencyKey_key" ON "team_intelligence_org_summaries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_reportDate_idx" ON "team_intelligence_org_summaries"("reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_source_reportDate_idx" ON "team_intelligence_org_summaries"("source", "reportDate");

-- CreateIndex
CREATE INDEX "team_intelligence_org_summaries_status_createdAt_idx" ON "team_intelligence_org_summaries"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "team_intelligence_user_ingestions"
ADD CONSTRAINT "team_intelligence_user_ingestions_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "team_intelligence_ingestion_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_intelligence_team_summaries"
ADD CONSTRAINT "team_intelligence_team_summaries_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "team_intelligence_ingestion_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_intelligence_org_summaries"
ADD CONSTRAINT "team_intelligence_org_summaries_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "team_intelligence_ingestion_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create explicit enum domain for org bullet categorization.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'TeamIntelligenceBulletCategory'
            AND n.nspname = 'public'
    ) THEN
        CREATE TYPE "public"."TeamIntelligenceBulletCategory" AS ENUM (
            'SHIPPED',
            'ACHIEVEMENT',
            'COLLABORATION',
            'LEARNING',
            'RECOGNITION',
            'LEARNED',
            'HELPED',
            'MILESTONE'
        );
    END IF;
END
$$;

-- Backfill existing org provenance bullets with bulletTitle + bulletCat.
UPDATE "team_intelligence_org_summaries"
SET "provenance" = jsonb_set(
    "provenance",
    '{bullets}',
    COALESCE(
        (
            SELECT jsonb_agg(
                CASE
                    WHEN jsonb_typeof(bullet) = 'object' THEN
                        jsonb_set(
                            jsonb_set(
                                bullet,
                                '{bulletTitle}',
                                to_jsonb(
                                    CASE
                                        WHEN COALESCE(NULLIF(trim(bullet->>'bulletTitle'), ''), '') <> '' THEN bullet->>'bulletTitle'
                                        ELSE left(regexp_replace(COALESCE(bullet->>'bulletText', ''), '\\s+', ' ', 'g'), 96)
                                    END
                                ),
                                true
                            ),
                            '{bulletCat}',
                            to_jsonb(
                                CASE
                                    WHEN lower(COALESCE(bullet->>'bulletCat', '')) IN ('shipped', 'achievement', 'collaboration', 'learning', 'recognition', 'learned', 'helped', 'milestone')
                                        THEN lower(bullet->>'bulletCat')
                                    WHEN lower(COALESCE(bullet->>'bulletText', '')) ~ '\\m(shipped|released|delivered|launched)\\M'
                                        THEN 'shipped'
                                    WHEN lower(COALESCE(bullet->>'bulletText', '')) ~ '(collaborat|partnered|cross[- ]?team|aligned)'
                                        THEN 'collaboration'
                                    WHEN lower(COALESCE(bullet->>'bulletText', '')) ~ '\\m(learned)\\M'
                                        THEN 'learned'
                                    WHEN lower(COALESCE(bullet->>'bulletText', '')) ~ '\\m(learning|learn|explored)\\M'
                                        THEN 'learning'
                                    WHEN lower(COALESCE(bullet->>'bulletText', '')) ~ '\\m(recognized|recognition|awarded|praised)\\M'
                                        THEN 'recognition'
                                    WHEN lower(COALESCE(bullet->>'bulletText', '')) ~ '\\m(helped|supported|assisted|unblocked)\\M'
                                        THEN 'helped'
                                    WHEN lower(COALESCE(bullet->>'bulletText', '')) ~ '(milestone|phase|rollout|go[- ]live)'
                                        THEN 'milestone'
                                    ELSE 'achievement'
                                END
                            ),
                            true
                        )
                    ELSE bullet
                END
            )
            FROM jsonb_array_elements(COALESCE("provenance"->'bullets', '[]'::jsonb)) AS bullet
        ),
        '[]'::jsonb
    ),
    true
)
WHERE "provenance" IS NOT NULL
    AND "provenance" ? 'bullets';
