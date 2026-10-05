-- Slack Connect reach performance: resolveReachableConnectIds() filters connect_group by
--   status = 'ACTIVE' AND invitedWorkspaceId = $ws
-- on EVERY canvas/channel ACL read and write (the host side is covered by each table's own
-- workspaceId index, so we only index the invited lookup). Without this index that is a
-- sequential scan of the whole (global, multi-tenant) connect_group table per query.
--
-- CONCURRENTLY: connect_group is written on every channel/canvas create, so a plain CREATE INDEX
-- would lock writes for the build. (This repo's runner applies migrations non-transactionally, so
-- CONCURRENTLY is safe here — see the emails/recaps index migrations.)

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "connect_group_invitedWorkspaceId_idx" ON "public"."connect_group"("invitedWorkspaceId");
