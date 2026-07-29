-- Allow external sources to be user-owned and channel-less for Gmail search
ALTER TABLE "workflow"."external_sources"
  ALTER COLUMN "channelId" DROP NOT NULL;

ALTER TABLE "workflow"."external_sources"
  ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

CREATE INDEX IF NOT EXISTS "external_sources_ownerUserId_idx"
  ON "workflow"."external_sources" ("ownerUserId");
