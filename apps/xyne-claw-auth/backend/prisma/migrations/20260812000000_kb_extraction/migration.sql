-- CreateTable
CREATE TABLE "kb_projects" (
    "projectId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "extractAgentSlug" TEXT,
    "mergeAgentSlug" TEXT,
    "reconcileAgentSlug" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "enabledBy" TEXT,
    "enabledAt" TIMESTAMP(3),

    CONSTRAINT "kb_projects_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "kb_channels" (
    "channelId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT false,
    "includedBy" TEXT,
    "includedAt" TIMESTAMP(3),
    "extractedThrough" TIMESTAMP(3),
    "backfillFrom" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "kb_channels_pkey" PRIMARY KEY ("channelId")
);

-- CreateTable
-- One row per job attempt across every stage of the pipeline. Deliberately has
-- no foreign key to kb_channels: a cascade would erase a channel's history the
-- moment it was removed from the KB, which is exactly when someone would go
-- looking for it.
CREATE TABLE "kb_runs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "channelId" TEXT,
    "windowFrom" TIMESTAMP(3),
    "windowTo" TIMESTAMP(3),
    "metrics" JSONB,
    "summary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "kb_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kb_projects_enabled_idx" ON "kb_projects"("enabled");

-- CreateIndex
CREATE INDEX "kb_channels_projectId_included_idx" ON "kb_channels"("projectId", "included");

-- CreateIndex
CREATE INDEX "kb_runs_projectCode_kind_startedAt_idx" ON "kb_runs"("projectCode", "kind", "startedAt");

-- CreateIndex
CREATE INDEX "kb_runs_kind_status_idx" ON "kb_runs"("kind", "status");

-- CreateIndex
CREATE INDEX "kb_runs_channelId_startedAt_idx" ON "kb_runs"("channelId", "startedAt");

-- AddForeignKey
ALTER TABLE "kb_channels" ADD CONSTRAINT "kb_channels_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "kb_projects"("projectId") ON DELETE CASCADE ON UPDATE CASCADE;
