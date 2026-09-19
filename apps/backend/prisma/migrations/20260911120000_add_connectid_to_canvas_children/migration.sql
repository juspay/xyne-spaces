-- AlterTable
ALTER TABLE "public"."canvas_versions" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_comment_threads" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_comments" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_participants" ADD COLUMN "connectId" TEXT;
ALTER TABLE "public"."canvas_user_status" ADD COLUMN "connectId" TEXT;

-- CreateIndex
CREATE INDEX "canvas_versions_connectId_idx" ON "public"."canvas_versions"("connectId");
CREATE INDEX "canvas_comment_threads_connectId_idx" ON "public"."canvas_comment_threads"("connectId");
CREATE INDEX "canvas_comments_connectId_idx" ON "public"."canvas_comments"("connectId");
CREATE INDEX "canvas_participants_connectId_idx" ON "public"."canvas_participants"("connectId");
CREATE INDEX "canvas_user_status_connectId_idx" ON "public"."canvas_user_status"("connectId");
