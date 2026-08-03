/*
  Warnings:

  - Made the column `workspaceId` on table `acl_audit_logs` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `activities` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `agent_steps` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `agent_tools_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `api_keys` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `app_commands` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `app_incoming_webhooks` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `app_permission` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `application_release_tickets` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `applications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `apps` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `board_complexity_scores` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `board_sla_policies` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `bookmarks` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `browser_notification_subscriptions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `call_messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `call_participants` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `call_recordings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `calls` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `canvas_folders` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `canvas_participants` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `canvas_user_status` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `canvas_versions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `canvases` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `channel_daily_recaps` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `channel_participants` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `channel_recaps` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `channel_stats` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `channel_user_status` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `classification_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `coes` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `collection_items` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `collection_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `collections` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `conversation_participants` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `conversations` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `custom_emojis` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `dashboard_activity` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `dashboard_participants` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `dashboard_queries_mapping` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `dashboards` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `data_source_columns` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `data_source_relationships` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `data_source_tables` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `delayed_messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `draft_messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `dynamic_dashboard_queries` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `dynamic_dashboard_queries_mapping` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `email_channel_preferences` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `email_drafts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `email_reads` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `email_signatures` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `emails` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `entities` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `entity_aliases` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `external_messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `external_sources` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `external_step_responses` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `form_entity_values` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `form_fields` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `forms_context_mapping` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `global_fields` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `impacts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `installed_app_commands` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `installed_app_permissions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `installed_apps` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `invitations` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `knowledge_documents` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `link_access` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `links` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `message_search` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `notification_preferences` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `notifications` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `proactive_nudges` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `project_tags` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `pull_requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `queries` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `rcas` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `reaction_counts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `reactions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `recaps` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `recurring_call_participants` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `recurring_call_series` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `release_attributions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `release_change_types` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `release_changes` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `release_events` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `repos` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `resource_access` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `saved_user_configuration_values` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `saved_user_configurations` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `scheduled_messages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `session_recording_files` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `stage_approvers` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `stage_pr_status_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `stage_transitions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `stages` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `surface_links` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `surface_nudge_counts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `surface_nudges` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_activities` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_assignments` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_entity_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_reference_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_stage_eta` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_stage_requests` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_sub_ticket_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_tag_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `ticket_tags` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_activity_events` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_assignment_states` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_expertise_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_external_tokens` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_group_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_preferences` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_presence` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_profiles` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_role_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_sessions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_skills` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `user_workload_mappings` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `workflow_execution_locks` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `workflow_execution_states` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `workflow_execution_users` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `workflow_executions` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `workflow_knowledge` required. This step will fail if there are existing NULL values in that column.
  - Made the column `workspaceId` on table `workflow_steps` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "non_zero"."call_messages" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."call_recordings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."dashboard_activity" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."dashboard_participants" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."data_source_columns" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."data_source_relationships" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."data_source_tables" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."dynamic_dashboard_queries" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."dynamic_dashboard_queries_mapping" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."scheduled_messages" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."user_external_tokens" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."user_skills" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."activities" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."agent_tools_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."app_commands" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."app_permission" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."application_release_tickets" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."applications" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."apps" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."board_complexity_scores" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."board_sla_policies" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."bookmarks" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."call_participants" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."calls" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."canvas_folders" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."canvas_participants" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."canvas_user_status" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."canvas_versions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."canvases" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."channel_daily_recaps" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."channel_participants" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."channel_recaps" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."channel_stats" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."channel_user_status" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."classification_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."coes" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."collection_items" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."collection_permissions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."collections" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."conversation_participants" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."conversations" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."custom_emojis" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."dashboard_queries_mapping" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."dashboards" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."delayed_messages" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."draft_messages" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."email_channel_preferences" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."email_drafts" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."email_reads" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."email_signatures" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."emails" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."form_entity_values" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."form_fields" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."forms_context_mapping" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."global_fields" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."impacts" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."installed_app_commands" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."installed_app_permissions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."installed_apps" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."invitations" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."knowledge_documents" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."link_access" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."links" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."messages" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."notification_preferences" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."proactive_nudges" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."project_tags" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."pull_requests" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."queries" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."rcas" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."reaction_counts" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."reactions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."recaps" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."recurring_call_participants" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."recurring_call_series" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."release_attributions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."release_change_types" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."release_changes" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."release_events" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."repos" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."resource_access" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."saved_user_configuration_values" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."saved_user_configurations" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."stage_approvers" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."stage_pr_status_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."stage_transitions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."stages" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."surface_links" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."surface_nudge_counts" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."surface_nudges" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_activities" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_assignments" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_entity_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_reference_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_stage_eta" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_stage_requests" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_sub_ticket_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_tag_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."ticket_tags" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_assignment_states" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_expertise_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_group_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_preferences" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_presence" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_profiles" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_role_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."user_workload_mappings" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "public"."workflow_executions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."acl_audit_logs" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."agent_steps" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."api_keys" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."app_incoming_webhooks" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."browser_notification_subscriptions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."external_messages" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."external_sources" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."external_step_responses" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."message_search" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."notifications" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."session_recording_files" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."user_activity_events" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."user_sessions" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."workflow_execution_locks" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."workflow_execution_states" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."workflow_execution_users" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."workflow_knowledge" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "workflow"."workflow_steps" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."entities" ALTER COLUMN "workspaceId" SET NOT NULL;

-- AlterTable
ALTER TABLE "non_zero"."entity_aliases" ALTER COLUMN "workspaceId" SET NOT NULL;
