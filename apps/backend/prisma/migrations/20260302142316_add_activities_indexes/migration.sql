-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_createdAt_id_idx" ON "public"."activities"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_actorAction_createdAt_id_idx" ON "public"."activities"("userId", "actorAction", "createdAt", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_classification_createdAt_id_idx" ON "public"."activities"("userId", "classification", "createdAt", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_actorAction_classification_createdAt_id_idx" ON "public"."activities"("userId", "actorAction", "classification", "createdAt", "id");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_actorAction_isRead_idx" ON "public"."activities"("userId", "actorAction", "isRead");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_isRead_createdAt_idx" ON "public"."activities"("userId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_isRead_actionSource_idx" ON "public"."activities"("userId", "isRead", "actionSource");
