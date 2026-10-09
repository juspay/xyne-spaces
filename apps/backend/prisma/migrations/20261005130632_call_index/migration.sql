-- CreateIndex
CREATE INDEX "calls_workspaceId_startedAt_id_idx" ON "public"."calls"("workspaceId", "startedAt" DESC, "id");

-- CreateIndex
CREATE INDEX "recurring_call_series_workspaceId_createdAt_id_idx" ON "public"."recurring_call_series"("workspaceId", "createdAt" DESC, "id");
