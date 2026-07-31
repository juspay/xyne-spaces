-- Add a unique constraint on (workspaceId, name, scopeType) for Channel to prevent duplicate DM / group-DM channels across a workspace.
CREATE UNIQUE INDEX IF NOT EXISTS "Channel_workspaceId_name_scopeType_key" ON "channels"("workspaceId", "name", "scopeType");
