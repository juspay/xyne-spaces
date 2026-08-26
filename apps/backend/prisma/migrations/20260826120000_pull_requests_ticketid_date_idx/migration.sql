-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pull_requests_ticketId_date_idx"
  ON "public"."pull_requests" ("ticketId", "date" DESC);
