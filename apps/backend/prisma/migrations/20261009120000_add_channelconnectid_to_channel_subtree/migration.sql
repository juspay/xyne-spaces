-- Slack Connect — `channelConnectId` on every table in a channel's subtree (87 tables). It holds the
-- owning channel's connect_group handle (channels.connectId) so the row can later be queried by that
-- handle and its workspace ACL resolved via connect_group. Column only: nullable, no default, so each
-- ADD COLUMN is a metadata-only change (no table rewrite). Rows with no channel stay NULL and keep
-- workspaceId truth. Writing and reading the column come in later changes.
-- Also `canvasConnectId` on sdlc_artifacts: its artifactId IS a canvas id, so like the other canvas
-- children it carries the parent canvas's own connect handle (canvases.connectId).

-- AlterTable
-- channel children (messaging, calls, extras, activities, AI) + canvases / canvas_participants
ALTER TABLE "public"."channel_participants" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."channel_stats" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."channel_user_status" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."conversations" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."messages" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."conversation_participants" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."message_artifacts" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."message_attachments" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."reactions" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."reaction_counts" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."calls" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."call_participants" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."call_recordings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."call_messages" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."recurring_call_series" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."recurring_call_participants" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."draft_messages" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."scheduled_messages" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."delayed_messages" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."links" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."link_access" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."entity_access" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."activities" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."surface_nudge_counts" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."proactive_nudges" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."channel_recaps" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."channel_daily_recaps" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."channel_published_tabs" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."canvases" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."canvas_participants" ADD COLUMN "channelConnectId" TEXT;

-- rest of the channel subtree (desk, email, tickets, workflows, sdlc, …)
ALTER TABLE "public"."conversation_labels" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."conversation_label_mappings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."emails" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."email_drafts" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."email_channel_preferences" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."classification_mappings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."canvas_folders" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."channel_board_mappings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."release_events" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."sdlc_entity_links" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."execution_items" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."pr_thread_links" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."radar_pr_links" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."app_incoming_webhooks" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."applications" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."collection_permissions" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."external_sources" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."invitations" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."repos" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."desk_auto_label_rule_references" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."tickets" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_activities" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_descriptions" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_user_mailbox" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."email_reads" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."sub_tickets" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_assignments" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_entity_mappings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_reference_mappings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_stage_eta" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_sub_ticket_mappings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_tags" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_tag_mappings" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."rcas" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."impacts" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."ticket_stage_requests" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."release_attributions" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."application_release_tickets" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."coes" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."release_changes" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."release_change_types" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."release_repositories" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."execution_thread_states" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."execution_item_mutations" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "non_zero"."execution_run_logs" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."workflow_execution_users" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."workflow_knowledge" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."pull_requests" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."workflows" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."workflow_executions" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."workflow_execution_locks" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."workflow_execution_states" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."workflow_steps" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."external_step_responses" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "workflow"."external_messages" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."sdlc_artifacts" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."sdlc_tracks" ADD COLUMN "channelConnectId" TEXT;
ALTER TABLE "public"."sdlc_artifacts" ADD COLUMN "canvasConnectId" TEXT;

-- CreateIndex
-- CONCURRENTLY: many of these (messages, tickets, ticket_activities, emails, workflow_steps, …) are large
-- and on the live write path; a plain CREATE INDEX would lock writes for the whole build. (This repo's
-- runner applies migrations non-transactionally, so CONCURRENTLY is safe — see the canvas-children migration.)
-- Shape: channelConnectId takes channelId's place in queries, so each table gets a copy of every index it
-- has on channelId (same columns, order and sort, channelId → channelConnectId). Unique channelId
-- constraints are copied as plain indexes: uniqueness stays enforced on channelId, and the handle is NULL
-- until backfilled. A table with a channelId column but no index on it copies its workspaceId indexes
-- instead (channelConnectId stands in for both); if it has none, it gets a single-column index. Tables
-- with no channelId column (they reach the channel via a parent) get a single-column index too, since
-- there channelConnectId stands in for workspaceId as the scope filter.
-- channel children (messaging, calls, extras, activities, AI) + canvases / canvas_participants
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_participants_channelConnectId_idx" ON "public"."channel_participants"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_participants_channelConnectId_id_idx" ON "public"."channel_participants"("channelConnectId", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_participants_channelConnectId_userId_id_idx" ON "public"."channel_participants"("channelConnectId", "userId", "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_participants_channelConnectId_userId_idx" ON "public"."channel_participants"("channelConnectId", "userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_stats_channelConnectId_idx" ON "public"."channel_stats"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_stats_workspaceId_lastActivityAt_channelConnectId_idx" ON "public"."channel_stats"("workspaceId", "lastActivityAt" DESC, "channelConnectId" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_user_status_channelConnectId_idx" ON "public"."channel_user_status"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_user_status_channelConnectId_userId_idx" ON "public"."channel_user_status"("channelConnectId", "userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_channelConnectId_idx" ON "public"."conversations"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_channelConnectId_createdAt_conversationId_idx" ON "public"."conversations"("channelConnectId", "createdAt" DESC, "conversationId" ASC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_channelConnectId_doNotPostToChannel_createdAt_idx" ON "public"."conversations"("channelConnectId", "doNotPostToChannel", "createdAt" DESC, "conversationId" ASC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversations_channelConnectId_lastActivityAt_idx" ON "public"."conversations"("channelConnectId", "lastActivityAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_channelConnectId_idx" ON "public"."messages"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_participants_channelConnectId_idx" ON "public"."conversation_participants"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_artifacts_channelConnectId_idx" ON "public"."message_artifacts"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_attachments_workspaceId_channelConnectId_createdAt__idx" ON "public"."message_attachments"("workspaceId", "channelConnectId", "createdAt" DESC, "id");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reactions_channelConnectId_idx" ON "public"."reactions"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "reaction_counts_channelConnectId_idx" ON "public"."reaction_counts"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_channelConnectId_idx" ON "public"."calls"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_channelConnectId_status_endedAt_idx" ON "public"."calls"("channelConnectId", "status", "endedAt" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_channelConnectId_status_startsAt_idx" ON "public"."calls"("channelConnectId", "status", "startsAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "call_participants_channelConnectId_idx" ON "public"."call_participants"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "call_recordings_channelConnectId_idx" ON "non_zero"."call_recordings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "call_messages_channelConnectId_idx" ON "non_zero"."call_messages"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "recurring_call_series_channelConnectId_idx" ON "public"."recurring_call_series"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "recurring_call_participants_channelConnectId_idx" ON "public"."recurring_call_participants"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "draft_messages_channelConnectId_conversationId_messageId_us_idx" ON "public"."draft_messages"("channelConnectId", "conversationId", "messageId", "userId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "scheduled_messages_channelConnectId_idx" ON "non_zero"."scheduled_messages"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "delayed_messages_channelConnectId_status_idx" ON "public"."delayed_messages"("channelConnectId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "links_channelConnectId_createdBy_idx" ON "public"."links"("channelConnectId", "createdBy");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "links_channelConnectId_visibility_idx" ON "public"."links"("channelConnectId", "visibility");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "links_createdBy_url_channelConnectId_idx" ON "public"."links"("createdBy", "url", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "link_access_channelConnectId_idx" ON "public"."link_access"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "entity_access_workspaceId_channelConnectId_idx" ON "public"."entity_access"("workspaceId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_channelConnectId_idx" ON "public"."activities"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "activities_classificationJobType_actionSourceId_channelConn_idx" ON "public"."activities"("classificationJobType", "actionSourceId", "channelConnectId", "classification");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "surface_nudge_counts_callId_channelConnectId_idx" ON "public"."surface_nudge_counts"("callId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "surface_nudge_counts_canvasId_channelConnectId_idx" ON "public"."surface_nudge_counts"("canvasId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "surface_nudge_counts_conversationId_channelConnectId_idx" ON "public"."surface_nudge_counts"("conversationId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "surface_nudge_counts_messageId_channelConnectId_idx" ON "public"."surface_nudge_counts"("messageId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "surface_nudge_counts_ticketId_channelConnectId_idx" ON "public"."surface_nudge_counts"("ticketId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "proactive_nudges_channelConnectId_idx" ON "public"."proactive_nudges"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_recaps_channelConnectId_idx" ON "public"."channel_recaps"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_daily_recaps_channelConnectId_idx" ON "public"."channel_daily_recaps"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_published_tabs_channelConnectId_entityType_entityId_idx" ON "public"."channel_published_tabs"("channelConnectId", "entityType", "entityId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvases_channelConnectId_idx" ON "public"."canvases"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_participants_channelConnectId_idx" ON "public"."canvas_participants"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_participants_canvasId_channelConnectId_idx" ON "public"."canvas_participants"("canvasId", "channelConnectId");

-- rest of the channel subtree (desk, email, tickets, workflows, sdlc, …)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_labels_channelConnectId_createdBy_name_idx" ON "public"."conversation_labels"("channelConnectId", "createdBy", "name");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_label_mappings_channelConnectId_idx" ON "public"."conversation_label_mappings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emails_channelConnectId_idx" ON "public"."emails"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emails_channelConnectId_rfcMessageId_idx" ON "public"."emails"("channelConnectId", "rfcMessageId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emails_channelConnectId_type_id_createdAt_idx" ON "public"."emails"("channelConnectId", "type", "id", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "emails_externalMessageId_channelConnectId_idx" ON "public"."emails"("externalMessageId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_drafts_channelConnectId_idx" ON "public"."email_drafts"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_channel_preferences_channelConnectId_idx" ON "public"."email_channel_preferences"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "classification_mappings_channelConnectId_idx" ON "public"."classification_mappings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "classification_mappings_channelConnectId_category_idx" ON "public"."classification_mappings"("channelConnectId", "category");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_folders_channelConnectId_idx" ON "public"."canvas_folders"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_folders_projectId_channelConnectId_idx" ON "public"."canvas_folders"("projectId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "canvas_folders_projectId_channelConnectId_name_idx" ON "public"."canvas_folders"("projectId", "channelConnectId", "name");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_board_mappings_channelConnectId_idx" ON "public"."channel_board_mappings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "channel_board_mappings_channelConnectId_boardId_idx" ON "public"."channel_board_mappings"("channelConnectId", "boardId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "release_events_channelConnectId_conversationId_idx" ON "public"."release_events"("channelConnectId", "conversationId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sdlc_entity_links_channelConnectId_relationType_idx" ON "public"."sdlc_entity_links"("channelConnectId", "relationType");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sdlc_entity_links_channelConnectId_sourceType_sourceId_targ_idx" ON "public"."sdlc_entity_links"("channelConnectId", "sourceType", "sourceId", "targetType", "targetId", "relationType");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_items_channelConnectId_status_idx" ON "non_zero"."execution_items"("channelConnectId", "status");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pr_thread_links_channelConnectId_idx" ON "non_zero"."pr_thread_links"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "radar_pr_links_channelConnectId_prUrl_idx" ON "non_zero"."radar_pr_links"("channelConnectId", "prUrl");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "app_incoming_webhooks_installedAppId_channelConnectId_idx" ON "workflow"."app_incoming_webhooks"("installedAppId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "applications_channelConnectId_idx" ON "public"."applications"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "collection_permissions_channelConnectId_idx" ON "public"."collection_permissions"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "collection_permissions_collectionId_channelConnectId_idx" ON "public"."collection_permissions"("collectionId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "external_sources_channelConnectId_idx" ON "workflow"."external_sources"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "invitations_channelConnectId_idx" ON "public"."invitations"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "repos_channelConnectId_canonicalUrl_idx" ON "public"."repos"("channelConnectId", "canonicalUrl");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "repos_channelConnectId_projectId_idx" ON "public"."repos"("channelConnectId", "projectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "desk_auto_label_rule_refs_channel_connect_idx" ON "non_zero"."desk_auto_label_rule_references"("workspaceId", "channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "desk_auto_label_rule_refs_filter_connect_idx" ON "non_zero"."desk_auto_label_rule_references"("workspaceId", "ownerId", "channelConnectId", "labelId", "filterFingerprint");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "desk_auto_label_rule_refs_owner_channel_connect_idx" ON "non_zero"."desk_auto_label_rule_references"("workspaceId", "ownerId", "channelConnectId", "createdAt" DESC, "id" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_channelConnectId_idx" ON "public"."tickets"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tickets_channelConnectId_merchantId_idx" ON "public"."tickets"("channelConnectId", "merchantId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_activities_channelConnectId_timestamp_idx" ON "public"."ticket_activities"("channelConnectId", "timestamp");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_descriptions_channelConnectId_idx" ON "public"."ticket_descriptions"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_user_mailbox_channelConnectId_idx" ON "public"."ticket_user_mailbox"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_reads_channelConnectId_idx" ON "public"."email_reads"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sub_tickets_channelConnectId_idx" ON "public"."sub_tickets"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_assignments_channelConnectId_idx" ON "public"."ticket_assignments"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_entity_mappings_channelConnectId_idx" ON "public"."ticket_entity_mappings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_reference_mappings_channelConnectId_idx" ON "public"."ticket_reference_mappings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_stage_eta_channelConnectId_idx" ON "public"."ticket_stage_eta"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_sub_ticket_mappings_channelConnectId_idx" ON "public"."ticket_sub_ticket_mappings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_tags_channelConnectId_idx" ON "public"."ticket_tags"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_tag_mappings_channelConnectId_idx" ON "public"."ticket_tag_mappings"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "rcas_channelConnectId_idx" ON "public"."rcas"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "impacts_channelConnectId_idx" ON "public"."impacts"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ticket_stage_requests_channelConnectId_idx" ON "public"."ticket_stage_requests"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "release_attributions_channelConnectId_idx" ON "public"."release_attributions"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "application_release_tickets_channelConnectId_idx" ON "public"."application_release_tickets"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "coes_channelConnectId_idx" ON "public"."coes"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "release_changes_channelConnectId_idx" ON "public"."release_changes"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "release_change_types_channelConnectId_idx" ON "public"."release_change_types"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "release_repositories_channelConnectId_idx" ON "non_zero"."release_repositories"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_thread_states_channelConnectId_idx" ON "non_zero"."execution_thread_states"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_item_mutations_channelConnectId_idx" ON "non_zero"."execution_item_mutations"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "execution_run_logs_channelConnectId_idx" ON "non_zero"."execution_run_logs"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_users_channelConnectId_idx" ON "workflow"."workflow_execution_users"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_knowledge_channelConnectId_idx" ON "workflow"."workflow_knowledge"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "pull_requests_channelConnectId_idx" ON "public"."pull_requests"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflows_channelConnectId_idx" ON "public"."workflows"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_executions_channelConnectId_idx" ON "workflow"."workflow_executions"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_locks_channelConnectId_idx" ON "workflow"."workflow_execution_locks"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_execution_states_channelConnectId_idx" ON "workflow"."workflow_execution_states"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "workflow_steps_channelConnectId_idx" ON "workflow"."workflow_steps"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "external_step_responses_channelConnectId_idx" ON "workflow"."external_step_responses"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "external_messages_channelConnectId_idx" ON "workflow"."external_messages"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sdlc_artifacts_channelConnectId_idx" ON "public"."sdlc_artifacts"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sdlc_tracks_channelConnectId_idx" ON "public"."sdlc_tracks"("channelConnectId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sdlc_artifacts_canvasConnectId_idx" ON "public"."sdlc_artifacts"("canvasConnectId");
