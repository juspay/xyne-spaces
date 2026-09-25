-- AlterTable
ALTER TABLE "public"."channels" ADD COLUMN "connectId" TEXT;

-- AlterTable
ALTER TABLE "public"."canvases" ADD COLUMN "connectId" TEXT;

-- CreateIndex
-- CONCURRENTLY: channels/canvases are on the live write path; a plain CREATE INDEX would lock
-- writes for the whole build on large tenants. (This repo's runner applies migrations
-- non-transactionally, so CONCURRENTLY is safe here — see the emails/recaps index migrations.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channels_connectId_idx" ON "public"."channels"("connectId");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvases_connectId_idx" ON "public"."canvases"("connectId");
