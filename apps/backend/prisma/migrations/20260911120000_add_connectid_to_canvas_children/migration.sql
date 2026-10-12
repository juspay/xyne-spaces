-- AlterTable
ALTER TABLE "public"."canvas_versions" ADD COLUMN "canvasConnectId" TEXT;
ALTER TABLE "public"."canvas_comment_threads" ADD COLUMN "canvasConnectId" TEXT;
ALTER TABLE "public"."canvas_comments" ADD COLUMN "canvasConnectId" TEXT;
ALTER TABLE "public"."canvas_participants" ADD COLUMN "canvasConnectId" TEXT;
ALTER TABLE "public"."canvas_user_status" ADD COLUMN "canvasConnectId" TEXT;

-- CreateIndex
-- CONCURRENTLY: these canvas child tables are on the live write path (comments/versions/participants);
-- a plain CREATE INDEX would lock writes for the whole build on large tenants. (This repo's runner
-- applies migrations non-transactionally, so CONCURRENTLY is safe — see the emails/recaps migrations.)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_versions_canvasConnectId_idx" ON "public"."canvas_versions"("canvasConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_comment_threads_canvasConnectId_idx" ON "public"."canvas_comment_threads"("canvasConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_comments_canvasConnectId_idx" ON "public"."canvas_comments"("canvasConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_participants_canvasConnectId_idx" ON "public"."canvas_participants"("canvasConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_user_status_canvasConnectId_idx" ON "public"."canvas_user_status"("canvasConnectId");
