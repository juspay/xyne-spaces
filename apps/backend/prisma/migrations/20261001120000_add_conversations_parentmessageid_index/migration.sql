CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_parentMessageId_idx"
  ON "public"."conversations" ("parentMessageId");
