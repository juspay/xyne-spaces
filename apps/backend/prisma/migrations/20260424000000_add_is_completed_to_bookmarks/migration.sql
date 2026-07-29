ALTER TABLE "public"."bookmarks"
  ADD COLUMN "isCompleted" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "bookmarks_userId_isCompleted_updatedAt_idx"
  ON "public"."bookmarks"("userId", "isCompleted", "updatedAt");
