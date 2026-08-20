import type { QueryContext, TableName } from './types';
import { BaseACL } from './base-acl';
import { ActivitiesACL } from '../tables/activities-acl';
import { GuestAccessACL } from '../tables/guest-access-acl';
import { CallParticipantsACL } from '../tables/call-participants-acl';
import { CallsACL } from '../tables/calls-acl';
import { CanvasFoldersACL } from '../tables/canvas-folders-acl';
import { CanvasCommentsACL } from '../tables/canvas-comments-acl';
import { CanvasCommentThreadsACL } from '../tables/canvas-comment-threads-acl';
import { CanvasParticipantsACL } from '../tables/canvas-participants-acl';
import { CanvasUserStatusACL } from '../tables/canvas-user-status-acl';
import { CanvasesACL } from '../tables/canvases-acl';
import { ChannelParticipantsACL } from '../tables/channel-participants-acl';
import { ChannelStatsACL } from '../tables/channel-stats-acl';
import { ChannelsACL } from '../tables/channels-acl';
import { ChannelBoardMappingsACL } from '../tables/channel-board-mappings-acl';
import { ConversationParticipantsACL } from '../tables/conversation-participants-acl';
import { ConversationsACL } from '../tables/conversations-acl';
import { MessageAttachmentsACL } from '../tables/message-attachments-acl';
import { MessagesACL } from '../tables/messages-acl';
import { MessageArtifactsACL } from '../tables/message-artifacts-acl';
import { NotificationPreferencesACL } from '../tables/notification-preferences-acl';
import { OrgMembersACL } from '../tables/org-members-acl';
import { OrganizationsACL } from '../tables/organizations-acl';
import { ReactionCountsACL } from '../tables/reaction-counts-acl';
import { ReactionsACL } from '../tables/reactions-acl';
import { RolesACL } from '../tables/roles-acl';
import { UserRoleMappingsACL } from '../tables/user-role-mappings-acl';
import { UserGroupMappingsACL } from '../tables/user-group-mappings-acl';
import { UserGroupsACL } from '../tables/user-groups-acl';
import { UserPresenceACL } from '../tables/user-presence-acl';
import { UsersACL } from '../tables/users-acl';
import { DenyGuestsACL } from './deny-guests-acl';
import { ProjectAcl } from '../tables/projects-acl';
import { StageAcl } from '../tables/stage-acl';
import { BoardAcl } from '../tables/boards-acl';
import { TicketACl } from '../tables/tickets-acl';
import { WOrkflowsAcl } from '../tables/workflows-acl';
import { WorkflowExecutionsAcl } from '../tables/workflow-executions-acl';
import { SubTicketsACL } from '../tables/sub-tickets-acl';
import { TicketSubTicketMappingsACL } from '../tables/ticket-sub-ticket-mappings-acl';
import { TicketActivitiesACL } from '../tables/ticket-activities-acl';
import { TicketEntityMappingsACL } from '../tables/ticket-entity-mappings-acl';
import { TicketReferenceMappingsACL } from '../tables/ticket-reference-mappings-acl';
import { TicketTagsACL } from '../tables/ticket-tags-acl';
import { ProjectTagsACL } from '../tables/project-tags-acl';
import { TicketTagMappingsACL } from '../tables/ticket-tag-mappings-acl';
import { PullRequestsACL } from '../tables/pull-requests-acl';
import { BookmarksACL } from '../tables/bookmarks-acl';
import { EmailSignaturesACL } from '../tables/email-signatures-acl';
import { EmailReadsACL } from '../tables/email-reads-acl';
import { EmailChannelPreferencesACL } from '../tables/email-channel-preferences-acl';
import { ChannelUserStatusACL } from '../tables/channel-user-status-acl';
import { ChannelSectionsACL } from '../tables/channel-sections-acl';
import { UserAssignmentStatesACL } from '../tables/user-assignment-states-acl';
import { BoardComplexityScoresACL } from '../tables/board-complexity-scores-acl';
import { UserWorkloadMappingsACL } from '../tables/user-workload-mappings-acl';
import { UserExpertiseMappingsACL } from '../tables/user-expertise-mappings-acl';
import { StagePRStatusMappingsACL } from '../tables/stage-pr-status-mappings-acl';
import { ResourcesACL } from '../tables/resources-acl';
import { ResourceAccessACL } from '../tables/resource-access-acl';
import { ProactiveNudgesACL } from '../tables/proactive-nudges-acl';
import { SurfaceNudgesACL } from '../tables/surface-nudges-acl';
import { SurfaceLinksACL } from '../tables/surface-links-acl';
import { SavedUserConfigurationsACL } from '../tables/saved-user-configurations-acl';
import { SavedUserConfigurationValuesACL } from '../tables/saved-user-configuration-values-acl';
import { AppsACL } from '../tables/apps-acl';
import { TicketAssignmentsACL } from '../tables/ticket-assignments-acl';
import { TicketStageEtaACL } from '../tables/ticket-stage-eta-acl';
import { UserProfilesACL } from '../tables/user-profiles-acl';
import { UserPreferencesACL } from '../tables/user-preferences-acl';
import { FormsACL } from '../tables/forms-acl';
import { FormContextMappingsACL } from '../tables/form-context-mappings-acl';
import { FormFieldsACL } from '../tables/form-fields-acl';
import { GlobalFieldsACL } from '../tables/global-fields-acl';
import { FormEntityValuesACL } from '../tables/form-entity-values-acl';
import { DelayedMessagesACL } from '../tables/delayed-messages-acl';
import { DraftMessagesACL } from '../tables/draft-messages-acl';
import { AgentToolsMappingsACL } from '../tables/agent-tools-mappings-acl';
import { AgentsACL } from '../tables/agents-acl';
import { ApplicationReleaseTicketsACL } from '../tables/application-release-tickets-acl';
import { ApplicationsACL } from '../tables/applications-acl';
import { BoardSlaPoliciesACL } from '../tables/board-sla-policies-acl';
import { CanvasVersionsACL } from '../tables/canvas-versions-acl';
import { CanvasSuggestionsACL } from '../tables/canvas-suggestions-acl';
import { CanvasSuggestionChangesACL } from '../tables/canvas-suggestion-changes-acl';
import { ChannelDailyRecapsACL } from '../tables/channel-daily-recaps-acl';
import { ChannelRecapsACL } from '../tables/channel-recaps-acl';
import { ClassificationMappingsACL } from '../tables/classification-mappings-acl';
import { CoesACL } from '../tables/coes-acl';
import { CollectionItemsACL } from '../tables/collection-items-acl';
import { CollectionPermissionsACL } from '../tables/collection-permissions-acl';
import { CollectionsACL } from '../tables/collections-acl';
import { ConversationLabelMappingsACL } from '../tables/conversation-label-mappings-acl';
import { ConversationLabelsACL } from '../tables/conversation-labels-acl';
import { CustomEmojisACL } from '../tables/custom-emojis-acl';
import { EntityAccessACL } from '../tables/entity-access-acl';
import { SummaryTemplatesACL } from '../tables/summary-templates-acl';
import { DashboardQueriesMappingACL } from '../tables/dashboard-queries-mapping-acl';
import { DashboardsACL } from '../tables/dashboards-acl';
import { EmailDraftsACL } from '../tables/email-drafts-acl';
import { EmailsACL } from '../tables/emails-acl';
import { ImpactsACL } from '../tables/impacts-acl';
import { InstalledAppsACL } from '../tables/installed-apps-acl';
import { InvitationsACL } from '../tables/invitations-acl';
import { LinkAccessACL } from '../tables/link-access-acl';
import { LinksACL } from '../tables/links-acl';
import { LookupValuesACL } from '../tables/lookup-values-acl';
import { MerchantsACL } from '../tables/merchants-acl';
import { ModelsACL } from '../tables/models-acl';
import { QueriesACL } from '../tables/queries-acl';
import { RcasACL } from '../tables/rcas-acl';
import { RecapsACL } from '../tables/recaps-acl';
import { RecurringCallParticipantsACL } from '../tables/recurring-call-participants-acl';
import { RecurringCallSeriesACL } from '../tables/recurring-call-series-acl';
import { ReleaseAttributionsACL } from '../tables/release-attributions-acl';
import { ReleaseChangeTypesACL } from '../tables/release-change-types-acl';
import { ReleaseChangesACL } from '../tables/release-changes-acl';
import { ReleaseEventsACL } from '../tables/release-events-acl';
import { ReposACL } from '../tables/repos-acl';
import { SdlcEntityLinksACL } from '../tables/sdlc-entity-links-acl';
import { SdlcTracksACL } from '../tables/sdlc-tracks-acl';
import { StageApproversACL } from '../tables/stage-approvers-acl';
import { StageTransitionsACL } from '../tables/stage-transitions-acl';
import { SurfaceNudgeCountsACL } from '../tables/surface-nudge-counts-acl';
import { TicketStageRequestsACL } from '../tables/ticket-stage-requests-acl';
import { TicketUserMailboxACL } from '../tables/ticket-user-mailbox-acl';
import { ToolsACL } from '../tables/tools-acl';
import { WorkspaceOrganizationsACL } from '../tables/workspace-organizations-acl';
import { WorkspacesACL } from '../tables/workspaces-acl';

// Tables where GUEST users may perform mutations.
// All other tables default to DenyGuestsACL for guest users.
// When adding a new table, decide: either add it to this list (with custom guest
// handling in its ACL class) or let it fall through to the default deny.
const GUEST_MUTATION_ALLOWLIST: readonly TableName[] = [
  'messages',
  'reactions',
  'message_attachments',
  'activities',
  'channel_user_status',
  'canvas_user_status',
  'user_presence',
  'bookmarks',
  'email_reads',
  'notification_preferences',
  'conversations',
  'conversation_participants',
  'delayed_messages',
  'call_participants',
  'canvas_participants',
  'canvases',
  'user_profiles',
  'user_preferences',
  'email_signatures',
  'saved_user_configurations',
  'saved_user_configuration_values',
  'channel_participants',
  'channel_stats',
  'draft_messages',
  'tickets',
  'ticket_activities',
  'sub_tickets',
  'ticket_stage_eta',
  'ticket_tags',
  'project_tags',
  'ticket_tag_mappings',
  'users',
];

export class ACLFactory {
  /**
   * Get ACL instance for a specific table
   *
   * @param table - The table name to get ACL for
   * @param ctx - Query context with user information
   * @returns ACL instance for the table, or NoOpACL if no specific ACL exists
   */
  static async getACL(table: TableName, ctx: QueryContext): Promise<BaseACL<any>> {
    // Guest users are denied mutations on all tables except those in the allowlist.
    // This is a safety net: new tables are blocked for guests by default.
    if (ctx.role === 'GUEST' && !GUEST_MUTATION_ALLOWLIST.includes(table)) {
      return new DenyGuestsACL<any>(ctx, table);
    }

    switch (table) {
      case 'activities':
        return new ActivitiesACL(ctx);
      case 'apps':
        return new AppsACL(ctx);
      case 'agent_tools_mappings':
        return new AgentToolsMappingsACL(ctx);
      case 'agents':
        return new AgentsACL(ctx);
      case 'board_complexity_scores':
        return new BoardComplexityScoresACL(ctx);
      case 'boards':
        return new BoardAcl(ctx);
      case 'bookmarks':
        return new BookmarksACL(ctx);
      case 'email_signatures':
        return new EmailSignaturesACL(ctx);
      case 'email_reads':
        return new EmailReadsACL(ctx);
      case 'email_channel_preferences':
        return new EmailChannelPreferencesACL(ctx);
      case 'call_participants':
        return new CallParticipantsACL(ctx);
      case 'calls':
        return new CallsACL(ctx);
      case 'canvas_folders':
        return new CanvasFoldersACL(ctx);
      case 'canvas_comment_threads':
        return new CanvasCommentThreadsACL(ctx);
      case 'canvas_comments':
        return new CanvasCommentsACL(ctx);
      case 'canvas_participants':
        return new CanvasParticipantsACL(ctx);
      case 'canvas_user_status':
        return new CanvasUserStatusACL(ctx);
      case 'canvases':
        return new CanvasesACL(ctx);
      case 'channel_participants':
        return new ChannelParticipantsACL(ctx);
      case 'channel_stats':
        return new ChannelStatsACL(ctx);
      case 'channels':
        return new ChannelsACL(ctx);
      case 'channel_board_mappings':
        return new ChannelBoardMappingsACL(ctx);
      case 'conversation_participants':
        return new ConversationParticipantsACL(ctx);
      case 'conversations':
        return new ConversationsACL(ctx);
      case 'message_attachments':
        return new MessageAttachmentsACL(ctx);
      case 'messages':
        return new MessagesACL(ctx);
      case 'message_artifacts':
        return new MessageArtifactsACL(ctx, table);
      case 'models':
        return new ModelsACL(ctx);
      case 'notification_preferences':
        return new NotificationPreferencesACL(ctx);
      case 'org_members':
        return new OrgMembersACL(ctx);
      case 'organizations':
        return new OrganizationsACL(ctx);
      case 'projects':
        return new ProjectAcl(ctx);
      case 'proactive_nudges':
        return new ProactiveNudgesACL(ctx);
      case 'surface_nudges':
        return new SurfaceNudgesACL(ctx);
      case 'pull_requests':
        return new PullRequestsACL(ctx);
      case 'reaction_counts':
        return new ReactionCountsACL(ctx);
      case 'reactions':
        return new ReactionsACL(ctx);
      case 'resources':
        return new ResourcesACL(ctx);
      case 'resource_access':
        return new ResourceAccessACL(ctx);
      case 'roles':
        return new RolesACL(ctx);
      case 'user_role_mappings':
        return new UserRoleMappingsACL(ctx);
      case 'stages':
        return new StageAcl(ctx);
      case 'stage_pr_status_mappings':
        return new StagePRStatusMappingsACL(ctx);
      case 'sub_tickets':
        return new SubTicketsACL(ctx);
      case 'ticket_activities':
        return new TicketActivitiesACL(ctx);
      case 'ticket_entity_mappings':
        return new TicketEntityMappingsACL(ctx);
      case 'ticket_reference_mappings':
        return new TicketReferenceMappingsACL(ctx);
      case 'ticket_sub_ticket_mappings':
        return new TicketSubTicketMappingsACL(ctx);
      case 'ticket_tags':
        return new TicketTagsACL(ctx);
      case 'project_tags':
        return new ProjectTagsACL(ctx);
      case 'ticket_tag_mappings':
        return new TicketTagMappingsACL(ctx);
      case 'tickets':
        return new TicketACl(ctx);
      case 'tools':
        return new ToolsACL(ctx);
      case 'user_assignment_states':
        return new UserAssignmentStatesACL(ctx);
      case 'user_expertise_mappings':
        return new UserExpertiseMappingsACL(ctx);
      case 'user_group_mappings':
        return new UserGroupMappingsACL(ctx);
      case 'user_groups':
        return new UserGroupsACL(ctx);
      case 'user_presence':
        return new UserPresenceACL(ctx);
      case 'user_workload_mappings':
        return new UserWorkloadMappingsACL(ctx);
      case 'users':
        return new UsersACL(ctx);
      case 'workflow_executions':
        return new WorkflowExecutionsAcl(ctx);
      case 'workflows':
        return new WOrkflowsAcl(ctx);
      case 'channel_user_status': 
        return new ChannelUserStatusACL(ctx);
      case 'channel_sections':
        return new ChannelSectionsACL(ctx);
      case 'user_profiles':
        return new UserProfilesACL(ctx);
      case 'user_preferences':
        return new UserPreferencesACL(ctx);
      case 'ticket_assignments':
        return new TicketAssignmentsACL(ctx);
      case 'ticket_stage_eta':
        return new TicketStageEtaACL(ctx);
      case 'forms':
        return new FormsACL(ctx);
      case 'forms_context_mapping':
        return new FormContextMappingsACL(ctx);
      case 'form_fields':
        return new FormFieldsACL(ctx);
      case 'global_fields':
        return new GlobalFieldsACL(ctx);
      case 'form_entity_values':
        return new FormEntityValuesACL(ctx);
      case 'rcas':
        return new RcasACL(ctx);
      case 'impacts':
        return new ImpactsACL(ctx);
      case 'coes':
        return new CoesACL(ctx);
      case 'saved_user_configurations':
        return new SavedUserConfigurationsACL(ctx);
      case 'saved_user_configuration_values':
        return new SavedUserConfigurationValuesACL(ctx);
      case 'surface_links':
        return new SurfaceLinksACL(ctx);
      case 'delayed_messages':
        return new DelayedMessagesACL(ctx);
      case 'draft_messages':
        return new DraftMessagesACL(ctx);
      case 'application_release_tickets':
        return new ApplicationReleaseTicketsACL(ctx);
      case 'applications':
        return new ApplicationsACL(ctx);
      case 'board_sla_policies':
        return new BoardSlaPoliciesACL(ctx);
      case 'canvas_versions':
        return new CanvasVersionsACL(ctx);
      case 'canvas_suggestions':
        return new CanvasSuggestionsACL(ctx);
      case 'canvas_suggestion_changes':
        return new CanvasSuggestionChangesACL(ctx);
      case 'channel_daily_recaps':
        return new ChannelDailyRecapsACL(ctx);
      case 'channel_recaps':
        return new ChannelRecapsACL(ctx);
      case 'classification_mappings':
        return new ClassificationMappingsACL(ctx);
      case 'collection_items':
        return new CollectionItemsACL(ctx);
      case 'collection_permissions':
        return new CollectionPermissionsACL(ctx);
      case 'collections':
        return new CollectionsACL(ctx);
      case 'conversation_label_mappings':
        return new ConversationLabelMappingsACL(ctx);
      case 'conversation_labels':
        return new ConversationLabelsACL(ctx);
      case 'custom_emojis':
        return new CustomEmojisACL(ctx);
      case 'entity_access':
        return new EntityAccessACL(ctx);
      case 'summary_templates':
        return new SummaryTemplatesACL(ctx);
      case 'dashboard_queries_mapping':
        return new DashboardQueriesMappingACL(ctx);
      case 'dashboards':
        return new DashboardsACL(ctx);
      case 'email_drafts':
        return new EmailDraftsACL(ctx);
      case 'emails':
        return new EmailsACL(ctx);
      case 'installed_apps':
        return new InstalledAppsACL(ctx);
      case 'invitations':
        return new InvitationsACL(ctx);
      case 'link_access':
        return new LinkAccessACL(ctx);
      case 'links':
        return new LinksACL(ctx);
      case 'lookup_values':
        return new LookupValuesACL(ctx);
      case 'merchants':
        return new MerchantsACL(ctx);
      case 'queries':
        return new QueriesACL(ctx);
      case 'recaps':
        return new RecapsACL(ctx);
      case 'recurring_call_participants':
        return new RecurringCallParticipantsACL(ctx);
      case 'recurring_call_series':
        return new RecurringCallSeriesACL(ctx);
      case 'release_attributions':
        return new ReleaseAttributionsACL(ctx);
      case 'release_change_types':
        return new ReleaseChangeTypesACL(ctx);
      case 'release_changes':
        return new ReleaseChangesACL(ctx);
      case 'release_events':
        return new ReleaseEventsACL(ctx);
      case 'repos':
        return new ReposACL(ctx);
      case 'sdlc_entity_links':
        return new SdlcEntityLinksACL(ctx);
      case 'sdlc_artifacts':
        // Server-written provenance table: no client mutations (BaseACL denies all).
        return new BaseACL<any>(ctx);
      case 'sdlc_tracks':
        return new SdlcTracksACL(ctx);
      case 'stage_approvers':
        return new StageApproversACL(ctx);
      case 'stage_transitions':
        return new StageTransitionsACL(ctx);
      case 'surface_nudge_counts':
        return new SurfaceNudgeCountsACL(ctx);
      case 'ticket_stage_requests':
        return new TicketStageRequestsACL(ctx);
      case 'ticket_user_mailbox':
        return new TicketUserMailboxACL(ctx);
      case 'workspace_organizations':
        return new WorkspaceOrganizationsACL(ctx);
      case 'workspaces':
        return new WorkspacesACL(ctx);
      case 'ticket_exports':
        return new BaseACL<any>(ctx);
      case 'guest_access':
        return new GuestAccessACL(ctx, table);
    }
  }
}
