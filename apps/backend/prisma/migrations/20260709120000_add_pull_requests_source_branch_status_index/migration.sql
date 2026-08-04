-- CreateIndex
-- XYNE-17075: resolveOpenPRByBranch (build_success merge-readiness recheck) filters pull_requests
-- by (sourceBranchName, status) on every green Jenkins build; without this index it full-scans the
-- table (only workflowExecutionId + date were indexed). CONCURRENTLY, in its own migration, so it
-- never takes a write lock on the large prod table (Rule #50).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pull_requests_sourceBranchName_status_idx" ON "public"."pull_requests"("sourceBranchName", "status");
