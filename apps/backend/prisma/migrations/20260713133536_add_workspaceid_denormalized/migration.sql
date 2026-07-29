-- AlterTable
ALTER TABLE "public"."agent_tools_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_sub_ticket_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_assignments" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_activities" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_entity_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_tags" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."project_tags" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_tag_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_reference_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_stage_eta" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."workflow_executions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."workflow_execution_states" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."workflow_execution_locks" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."workflow_execution_users" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."workflow_steps" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."workflow_knowledge" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."knowledge_documents" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."agent_steps" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."external_step_responses" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."api_keys" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_role_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."user_sessions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_preferences" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."user_skills" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."scheduled_messages" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."call_messages" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_group_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_assignment_states" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."board_complexity_scores" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_workload_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_expertise_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_presence" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."user_profiles" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."resource_access" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."acl_audit_logs" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."pull_requests" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."team_intelligence_user_ingestions_v2" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."team_intelligence_team_summaries_v2" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."team_intelligence_org_summaries_v2" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."stages" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."stage_pr_status_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."stage_transitions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."channel_stats" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."channel_participants" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."channel_user_status" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."conversation_participants" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."emails" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."email_drafts" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."email_reads" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."email_signatures" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."classification_mappings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."board_sla_policies" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."message_search" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."reactions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."reaction_counts" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."custom_emojis" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."user_external_tokens" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."external_messages" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."proactive_nudges" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."surface_nudges" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."surface_nudge_counts" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."notifications" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."notification_preferences" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."browser_notification_subscriptions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."calls" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."call_participants" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."call_recordings" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."recurring_call_series" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."recurring_call_participants" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."canvas_folders" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."canvases" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."canvas_versions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."canvas_participants" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."canvas_user_status" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."bookmarks" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."links" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."link_access" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."vespa_insertion_logs" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."repos" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."forms_context_mapping" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."global_fields" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."form_fields" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."form_entity_values" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."dashboards" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."queries" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."dashboard_queries_mapping" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."draft_messages" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."user_activity_events" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."collections" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."collection_items" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."collection_permissions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."stage_approvers" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."applications" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."application_release_tickets" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."release_events" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."release_changes" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."release_change_types" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."ticket_stage_requests" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."rcas" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."impacts" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."coes" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."release_attributions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."recaps" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."channel_daily_recaps" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."channel_recaps" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."session_recording_files" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."surface_links" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."apps" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."installed_apps" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."installed_app_commands" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "workflow"."app_incoming_webhooks" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."app_commands" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."saved_user_configurations" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."saved_user_configuration_values" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."delayed_messages" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."data_source_tables" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."data_source_columns" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."data_source_relationships" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."dashboard_participants" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."dashboard_activity" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."dynamic_dashboard_queries" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."dynamic_dashboard_queries_mapping" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."app_permission" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."installed_app_permissions" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."docling_async_files" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "non_zero"."docling_async_parts" ADD COLUMN     "workspaceId" TEXT;

