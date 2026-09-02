ALTER TABLE "public"."canvas_comment_threads"
ADD COLUMN "workspaceId" TEXT;

UPDATE "public"."canvas_comment_threads" AS thread
SET "workspaceId" = canvas."workspaceId"
FROM "public"."canvases" AS canvas
WHERE thread."canvasId" = canvas."id"
  AND thread."workspaceId" IS NULL;

ALTER TABLE "public"."canvas_comments"
ADD COLUMN "workspaceId" TEXT;

UPDATE "public"."canvas_comments" AS comment
SET "workspaceId" = thread."workspaceId"
FROM "public"."canvas_comment_threads" AS thread
WHERE comment."threadId" = thread."id"
  AND comment."workspaceId" IS NULL;

DROP INDEX IF EXISTS "public"."canvas_comment_threads_canvasId_createdAt_idx";
DROP INDEX IF EXISTS "public"."canvas_comments_threadId_isInitial_createdAt_idx";

CREATE INDEX "canvas_comment_threads_workspaceId_canvasId_createdAt_idx"
ON "public"."canvas_comment_threads"("workspaceId", "canvasId", "createdAt");

CREATE INDEX "canvas_comments_workspaceId_threadId_isInitial_createdAt_idx"
ON "public"."canvas_comments"("workspaceId", "threadId", "isInitial", "createdAt");
