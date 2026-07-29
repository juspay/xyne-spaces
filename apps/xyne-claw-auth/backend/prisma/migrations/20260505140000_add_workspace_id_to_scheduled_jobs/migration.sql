-- Add workspaceId to scheduled_jobs so the worker can pass it to Spaces' app
-- API (postMessage / openDm) which now requires the field. Nullable for
-- backward compatibility with rows created before this migration; those rows
-- will fail result delivery until recreated.

ALTER TABLE "scheduled_jobs" ADD COLUMN "workspaceId" TEXT;
