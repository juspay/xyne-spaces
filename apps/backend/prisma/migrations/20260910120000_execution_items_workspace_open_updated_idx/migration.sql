-- CreateIndex
-- The Pending Others feed is the first execution_items read with no positive
-- GIN predicate to drive off: its array conditions are a negation and an
-- emptiness test, which GIN cannot serve, and its channel scope is a relation
-- filter probed per row rather than a leading predicate. Without this the
-- planner sequentially scans the table and top-N sorts by updatedAt on every
-- Radar mount and tab refocus; with it the ORDER BY updatedAt DESC LIMIT walks
-- the index in order and stops.
-- CONCURRENTLY: the table is read on the message write path via the parse queue.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_items_workspaceId_status_updatedAt_idx"
  ON "non_zero"."execution_items" ("workspaceId", "status", "updatedAt" DESC);
