-- Prisma model: CanvasCommentThread
CREATE TABLE "public"."canvas_comment_threads" (
  "id" TEXT NOT NULL,
  "canvasId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "anchorText" TEXT,
  "initialCommentId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "statusUpdatedBy" TEXT,
  "statusUpdatedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "canvas_comment_threads_pkey" PRIMARY KEY ("id")
);

-- Prisma model: CanvasComment
CREATE TABLE "public"."canvas_comments" (
  "id" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "canvasId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "mentionedUserIds" TEXT NOT NULL DEFAULT '[]',
  "isInitial" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "editedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "canvas_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "canvas_comment_threads_canvasId_createdAt_idx"
ON "public"."canvas_comment_threads"("canvasId", "createdAt");

CREATE INDEX "canvas_comments_threadId_isInitial_createdAt_idx"
ON "public"."canvas_comments"("threadId", "isInitial", "createdAt");
