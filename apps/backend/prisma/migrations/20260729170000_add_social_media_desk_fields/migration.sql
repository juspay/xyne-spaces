ALTER TYPE "public"."DeskType" ADD VALUE IF NOT EXISTS 'SOCIAL_MEDIA';
ALTER TYPE "public"."ChannelType" ADD VALUE IF NOT EXISTS 'SOCIAL_MEDIA';

DROP INDEX IF EXISTS "workflow"."external_sources_workspaceId_sourceType_key";

CREATE UNIQUE INDEX "external_sources_workspaceId_sourceType_externalIdentifier_key"
ON "workflow"."external_sources"("workspaceId", "sourceType", "externalIdentifier");

CREATE UNIQUE INDEX "external_sources_workspaceId_sourceType_singleton_key"
ON "workflow"."external_sources"("workspaceId", "sourceType")
WHERE "sourceType" <> 'google-play-reviews';

ALTER TABLE "public"."emails"
ADD COLUMN "rating" INTEGER,
ADD COLUMN "clientVersionName" TEXT,
ADD COLUMN "clientVersionCode" TEXT;

CREATE INDEX "emails_workspaceId_rating_idx"
ON "public"."emails"("workspaceId", "rating");

CREATE INDEX "emails_workspaceId_clientVersionName_idx"
ON "public"."emails"("workspaceId", "clientVersionName");
