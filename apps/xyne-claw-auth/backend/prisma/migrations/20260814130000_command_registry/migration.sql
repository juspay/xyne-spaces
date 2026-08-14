-- Custom slash-command registry: a command is a saved, parameterized /goal loop.
-- Uniqueness is per-org (orgId, slug) so two orgs may each define their own slug.
CREATE TABLE "command_definitions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "template" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "maxTurns" INTEGER,
    "maxWallClockMs" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "command_definitions_orgId_slug_key" ON "command_definitions"("orgId", "slug");
CREATE INDEX "command_definitions_orgId_idx" ON "command_definitions"("orgId");

-- Observability: which registered command (if any) started an active goal loop.
-- Additive + nullable → existing rows and typed /goal loops are unaffected.
ALTER TABLE "active_goals" ADD COLUMN "commandSlug" TEXT;
