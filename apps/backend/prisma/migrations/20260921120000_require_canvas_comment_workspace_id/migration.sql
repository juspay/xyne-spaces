ALTER TABLE "public"."canvas_comment_threads"
ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "public"."canvas_comments"
ALTER COLUMN "workspaceId" SET NOT NULL;

DROP INDEX IF EXISTS "public"."canvas_comment_threads_canvasId_createdAt_idx";
DROP INDEX IF EXISTS "public"."canvas_comments_threadId_isInitial_createdAt_idx";

CREATE INDEX CONCURRENTLY "canvas_comment_threads_workspaceId_canvasId_createdAt_idx"
ON "public"."canvas_comment_threads"("workspaceId", "canvasId", "createdAt");

CREATE INDEX CONCURRENTLY "canvas_comments_workspaceId_threadId_createdAt_idx"
ON "public"."canvas_comments"("workspaceId", "threadId", "createdAt");
