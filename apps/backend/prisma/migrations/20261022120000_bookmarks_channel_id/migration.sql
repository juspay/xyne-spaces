-- Channel-scoped bookmarks: denormalize the channel of a MESSAGE bookmark so the
-- channel "Bookmarks" tab can query by (userId, channelId) instead of loading every
-- bookmarked message client-side and filtering.
ALTER TABLE "public"."bookmarks" ADD COLUMN "channelId" TEXT;

CREATE INDEX "bookmarks_userId_channelId_isDeleted_idx"
  ON "public"."bookmarks"("userId", "channelId", "isDeleted");

-- Backfill existing MESSAGE bookmarks (thread replies resolve via their thread
-- conversation, which carries the parent channelId). Unresolvable rows stay NULL
-- and keep appearing in the global Bookmarks panel only.
UPDATE "public"."bookmarks" b
SET "channelId" = c."channelId"
FROM "public"."messages" m
JOIN "public"."conversations" c ON c."conversationId" = m."conversationId"
WHERE b."entityType" = 'MESSAGE'
  AND b."channelId" IS NULL
  AND m."messageId" = b."entityId";
