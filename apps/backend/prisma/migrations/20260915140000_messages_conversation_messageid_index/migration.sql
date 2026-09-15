-- Zero's related-messages source fill reads a whole thread as
-- `WHERE "conversationId" = ? ORDER BY "messageId" asc`. No existing index
-- covers that order after the equality, so every fetch pays a temp B-tree
-- sort (~40% of the statement on a 3k-message thread). Both columns are
-- immutable, so the index sees inserts only.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversationId_messageId_idx"
  ON "public"."messages" ("conversationId", "messageId");
