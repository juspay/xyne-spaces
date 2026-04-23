-- Performance indices to eliminate TEMP B-TREE in zero-cache SQLite queries.
-- Each composite index covers WHERE + ORDER BY columns including the id tiebreaker
-- that Zero appends for deterministic ordering.

-- tickets
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_isArchived_createdAt_id_idx" ON "public"."tickets" ("isArchived", "createdAt" DESC, "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_projectId_createdAt_id_idx" ON "public"."tickets" ("projectId", "createdAt" DESC, "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_workspaceId_createdAt_id_idx" ON "public"."tickets" ("workspaceId", "createdAt" DESC, "id");

-- ticket_sub_ticket_mappings
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_sub_ticket_mappings_ticketId_id_idx" ON "public"."ticket_sub_ticket_mappings" ("ticketId", "id");

-- ticket_assignments
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_assignments_ticketId_id_idx" ON "public"."ticket_assignments" ("ticketId", "id");

-- workflows
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflows_ticketId_createdAt_id_idx" ON "public"."workflows" ("ticketId", "createdAt", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflows_createdAt_id_idx" ON "public"."workflows" ("createdAt" DESC, "id");

-- user_groups
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_groups_workspaceId_createdAt_id_idx" ON "public"."user_groups" ("workspaceId", "createdAt" DESC, "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_groups_workspaceId_name_id_idx" ON "public"."user_groups" ("workspaceId", "name", "id");

-- users
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_workspaceId_id_idx" ON "public"."users" ("workspaceId", "id");

-- resources
CREATE INDEX CONCURRENTLY IF NOT EXISTS "resources_name_id_idx" ON "public"."resources" ("name", "id");

-- resource_access
CREATE INDEX CONCURRENTLY IF NOT EXISTS "resource_access_userId_id_idx" ON "public"."resource_access" ("userId", "id");

-- projects
CREATE INDEX CONCURRENTLY IF NOT EXISTS "projects_workspaceId_createdAt_id_idx" ON "public"."projects" ("workspaceId", "createdAt" DESC, "id");

-- boards
CREATE INDEX CONCURRENTLY IF NOT EXISTS "boards_workspaceId_createdAt_id_idx" ON "public"."boards" ("workspaceId", "createdAt" DESC, "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "boards_projectId_createdAt_id_idx" ON "public"."boards" ("projectId", "createdAt", "id");

-- channels
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channels_workspaceId_id_idx" ON "public"."channels" ("workspaceId", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channels_workspaceId_name_id_idx" ON "public"."channels" ("workspaceId", "name", "id");

-- channel_participants
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_participants_channelId_id_idx" ON "public"."channel_participants" ("channelId", "id");

-- channel_user_status
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_user_status_userId_isDeleted_id_idx" ON "public"."channel_user_status" ("userId", "isDeleted", "id");

-- conversation_participants
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_participants_userId_id_idx" ON "public"."conversation_participants" ("userId", "id");

-- emails
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emails_conversationId_id_idx" ON "public"."emails" ("conversationId", "id");

-- messages
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_conversationId_createdAt_messageId_idx" ON "public"."messages" ("conversationId", "createdAt", "messageId");

-- custom_emojis
CREATE INDEX CONCURRENTLY IF NOT EXISTS "custom_emojis_createdAt_id_idx" ON "public"."custom_emojis" ("createdAt" DESC, "id");

-- activities
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_updatedAt_id_idx" ON "public"."activities" ("userId", "updatedAt" DESC, "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_userId_actorAction_isRead_id_idx" ON "public"."activities" ("userId", "actorAction", "isRead", "id");

-- calls
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_status_startedAt_externalId_idx" ON "public"."calls" ("status", "startedAt" DESC, "externalId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_status_startsAt_externalId_idx" ON "public"."calls" ("status", "startsAt", "externalId");

-- canvases
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvases_createdBy_updatedAt_id_idx" ON "public"."canvases" ("createdBy", "updatedAt" DESC, "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvases_docType_updatedAt_id_idx" ON "public"."canvases" ("docType", "updatedAt" DESC, "id");

-- bookmarks
CREATE INDEX CONCURRENTLY IF NOT EXISTS "bookmarks_userId_createdAt_id_idx" ON "public"."bookmarks" ("userId", "createdAt" DESC, "id");

-- forms
CREATE INDEX CONCURRENTLY IF NOT EXISTS "forms_workspaceId_createdAt_id_idx" ON "public"."forms" ("workspaceId", "createdAt" DESC, "id");

-- merchants
CREATE INDEX CONCURRENTLY IF NOT EXISTS "merchants_mid_id_idx" ON "public"."merchants" ("mid", "id");
