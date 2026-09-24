
-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stages_boardId_sequenceNumber_id_idx" ON "public"."stages"("boardId", "sequenceNumber", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stage_transitions_boardId_id_idx" ON "public"."stage_transitions"("boardId", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "stage_approvers_transitionId_id_idx" ON "public"."stage_approvers"("transitionId", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_stage_requests_ticketId_createdAt_id_idx" ON "public"."ticket_stage_requests"("ticketId", "createdAt" DESC, "id");
