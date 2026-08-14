-- attachmentsByTicket/attachmentsByImpact filter (entityId, entityType) and
-- order by createdAt. The planner previously served them via the
-- single-column entityType index — scanning EVERY ticket-typed attachment in
-- the workspace plus a sort, instead of just the queried entity's rows.
-- createdAt is immutable, so this index is insert-only (no update churn).
-- Apply on prod with CREATE INDEX CONCURRENTLY before deploying.
CREATE INDEX IF NOT EXISTS "message_attachments_entityId_entityType_createdAt_idx"
  ON "message_attachments"("entityId", "entityType", "createdAt" DESC);
