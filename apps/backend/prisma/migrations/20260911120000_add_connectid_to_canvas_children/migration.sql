-- AlterTable
ALTER TABLE "public"."canvas_versions" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_comment_threads" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_comments" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_participants" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_user_status" ADD COLUMN "connectId" TEXT;

-- CreateIndex
-- CONCURRENTLY: these canvas child tables are on the live write path (comments/versions/participants);
-- a plain CREATE INDEX would lock writes for the whole build on large tenants. (This repo's runner
-- applies migrations non-transactionally, so CONCURRENTLY is safe — see the emails/recaps migrations.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_versions_connectId_idx" ON "public"."canvas_versions"("connectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_comment_threads_connectId_idx" ON "public"."canvas_comment_threads"("connectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_comments_connectId_idx" ON "public"."canvas_comments"("connectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_participants_connectId_idx" ON "public"."canvas_participants"("connectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_user_status_connectId_idx" ON "public"."canvas_user_status"("connectId");
