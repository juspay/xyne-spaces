-- Prisma models: EntityTypeDefinition (mapped to table "entity_type_definitions"),
-- EntityExtractionRun (mapped to table "entity_extraction_runs").
-- Entity extraction: the approved type vocabulary and the discovery runs.
-- Enums are plain text here per this schema's enum→text convention.
--
-- The entity registry (entities, entity_aliases) is deliberately NOT here — it
-- lives in the Spaces backend alongside message ingest and the Vespa write
-- path. claw-auth discovers and stores TYPES; it never mints an entityId.
-- pg_trgm is likewise the backend's concern, since alias fuzzy matching runs
-- there.

-- CreateTable
CREATE TABLE "entity_type_definitions" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "examples" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "proposedInRunId" TEXT,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deprecatedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_type_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_extraction_runs" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "stage" TEXT NOT NULL DEFAULT 'FETCHING_MESSAGES',
    "settings" JSONB NOT NULL,
    "proposedTypes" JSONB,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "documentCount" INTEGER NOT NULL DEFAULT 0,
    "approvedTypeNames" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "triggeredByUserId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "entity_extraction_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "entity_type_definitions_workspaceId_name_key" ON "entity_type_definitions"("workspaceId", "name");
CREATE INDEX "entity_type_definitions_workspaceId_status_idx" ON "entity_type_definitions"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "entity_extraction_runs_workspaceId_channelId_status_idx" ON "entity_extraction_runs"("workspaceId", "channelId", "status");
CREATE INDEX "entity_extraction_runs_workspaceId_status_idx" ON "entity_extraction_runs"("workspaceId", "status");
