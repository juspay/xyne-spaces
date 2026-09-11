-- SDLC hub schema.
--
-- This migration is the collapsed form of what was originally three migrations
-- (add_sdlc_hub, remove_sdlc_vcs_runtime_grants, remove_project_sdlc_board).
-- Everything the later two dropped is simply never created here, so a fresh
-- database reaches the same end state without the create-then-drop churn.
-- The dropped pieces are kept verbatim at the bottom of this file, commented
-- out, in case any of them needs to be reinstated later.

-- AlterTable
ALTER TABLE "public"."repos" ADD COLUMN     "accessCapabilities" JSONB,
ADD COLUMN     "canonicalUrl" TEXT,
ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "sdlcSetupExecutionId" TEXT;

-- CreateTable
CREATE TABLE "public"."sdlc_entity_links" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationType" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdlc_entity_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sdlc_entity_links_workspaceId_repoId_idx" ON "public"."sdlc_entity_links"("workspaceId", "repoId");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_repoId_sourceType_sourceId_idx" ON "public"."sdlc_entity_links"("repoId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "sdlc_entity_links_repoId_targetType_targetId_idx" ON "public"."sdlc_entity_links"("repoId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "sdlc_entity_links_repoId_sourceType_sourceId_targetType_tar_key" ON "public"."sdlc_entity_links"("repoId", "sourceType", "sourceId", "targetType", "targetId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "repos_sdlcSetupExecutionId_key" ON "public"."repos"("sdlcSetupExecutionId");

-- CreateIndex
CREATE INDEX "repos_projectId_idx" ON "public"."repos"("projectId");

-- CreateIndex
CREATE INDEX "repos_workspaceId_projectId_idx" ON "public"."repos"("workspaceId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "repos_workspaceId_canonicalUrl_key" ON "public"."repos"("workspaceId", "canonicalUrl");


-- ---------------------------------------------------------------------------
-- Superseded DDL, kept for reference only. None of it runs.
--
-- These objects were created by the original 20260808162841_add_sdlc_hub and
-- removed again by 20260810144756_remove_sdlc_vcs_runtime_grants and
-- 20260814090000_remove_project_sdlc_board before the branch ever merged.
-- Uncomment a block here (in a NEW migration, not this one) if the feature it
-- backs is revived.
-- ---------------------------------------------------------------------------

-- (1) Per-run VCS credential grants. Replaced by the short-lived credential
--     envelope in apps/backend/src/sdlc/vcs/credentialEnvelope.ts, which needs
--     no persisted grant rows.
--
-- CREATE TABLE "workflow"."sdlc_vcs_runtime_grants" (
--     "id" TEXT NOT NULL,
--     "workspaceId" TEXT NOT NULL,
--     "repoId" TEXT NOT NULL,
--     "provider" TEXT NOT NULL,
--     "operation" TEXT NOT NULL,
--     "credentialRevision" INTEGER NOT NULL,
--     "executionId" TEXT NOT NULL,
--     "sessionId" TEXT NOT NULL,
--     "expiresAt" TIMESTAMP(3) NOT NULL,
--     "redeemedAt" TIMESTAMP(3),
--     "sandboxId" TEXT,
--     "sandboxPublicKeyHash" TEXT,
--     "envelopeIssuedAt" TIMESTAMP(3),
--     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--
--     CONSTRAINT "sdlc_vcs_runtime_grants_pkey" PRIMARY KEY ("id")
-- );
--
-- CREATE INDEX "sdlc_vcs_runtime_grants_workspaceId_repoId_idx" ON "workflow"."sdlc_vcs_runtime_grants"("workspaceId", "repoId");
-- CREATE INDEX "sdlc_vcs_runtime_grants_executionId_sessionId_idx" ON "workflow"."sdlc_vcs_runtime_grants"("executionId", "sessionId");
-- CREATE INDEX "sdlc_vcs_runtime_grants_expiresAt_idx" ON "workflow"."sdlc_vcs_runtime_grants"("expiresAt");
-- CREATE UNIQUE INDEX "sdlc_vcs_grant_sandbox_binding_key" ON "workflow"."sdlc_vcs_runtime_grants"("executionId", "sessionId", "repoId", "operation", "sandboxId", "sandboxPublicKeyHash");

-- (2) Persisted repo access-check results. The check is now computed on demand
--     (apps/backend/src/sdlc/vcs/accessCheckPolicy.ts); only the derived
--     "accessCapabilities" JSON above is still stored.
--
-- ALTER TABLE "public"."repos" ADD COLUMN     "accessCheckStartedAt" TIMESTAMP(3),
-- ADD COLUMN     "accessCheckStatus" TEXT NOT NULL DEFAULT 'NOT_CHECKED',
-- ADD COLUMN     "accessCheckedAt" TIMESTAMP(3),
-- ADD COLUMN     "accessCredentialRevision" INTEGER,
-- ADD COLUMN     "accessErrorCode" TEXT,
-- ADD COLUMN     "accessErrorMessage" TEXT,
-- ADD COLUMN     "accessEvidence" JSONB;

-- (3) Dedicated SDLC board per project. SDLC boards are now ordinary project
--     boards, so no dedicated pointer column is needed.
--
-- ALTER TABLE "public"."projects" ADD COLUMN     "sdlcBoardId" TEXT;
-- CREATE UNIQUE INDEX "projects_sdlcBoardId_key" ON "public"."projects"("sdlcBoardId");
