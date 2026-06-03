-- Add SLACK to ChannelType enum
ALTER TYPE "public"."ChannelType" ADD VALUE IF NOT EXISTS 'SLACK';

-- Add SLACK to DeskType enum
ALTER TYPE "public"."DeskType" ADD VALUE IF NOT EXISTS 'SLACK';

-- Change ExternalSource unique constraint from workspaceId-only to compound (workspaceId, sourceType)
-- This allows each workspace to have one source per type (google, microsoft, slack, etc.)
DROP INDEX IF EXISTS "workflow"."external_sources_workspaceId_key";
CREATE UNIQUE INDEX "external_sources_workspaceId_sourceType_key" ON "workflow"."external_sources"("workspaceId", "sourceType");

-- Per-user OAuth tokens for external providers (Slack send-as-user, etc.)
CREATE TABLE "non_zero"."user_external_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT,
    "encryptedToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_external_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_external_tokens_userId_provider_key" ON "non_zero"."user_external_tokens"("userId", "provider");
CREATE INDEX "user_external_tokens_provider_idx" ON "non_zero"."user_external_tokens"("provider");
CREATE INDEX "user_external_tokens_userId_idx" ON "non_zero"."user_external_tokens"("userId");
