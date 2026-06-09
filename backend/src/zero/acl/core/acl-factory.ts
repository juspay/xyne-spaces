import type { QueryContext, TableName } from './types';
import { BaseACL } from './base-acl';
import { ActivitiesACL } from '../tables/activities-acl';
import { CallParticipantsACL } from '../tables/call-participants-acl';
import { CallsACL } from '../tables/calls-acl';
import { CanvasFoldersACL } from '../tables/canvas-folders-acl';
import { CanvasParticipantsACL } from '../tables/canvas-participants-acl';
import { CanvasUserStatusACL } from '../tables/canvas-user-status-acl';
import { CanvasesACL } from '../tables/canvases-acl';
import { DashboardsACL } from '../tables/dashboards-acl';
import { DashboardParticipantsACL } from '../tables/dashboard-participants-acl';
import { DashboardQueriesMappingACL } from '../tables/dashboard-queries-mapping-acl';
import { QueriesACL } from '../tables/queries-acl';
import { ChannelParticipantsACL } from '../tables/channel-participants-acl';
import { ChannelStatsACL } from '../tables/channel-stats-acl';
import { ChannelsACL } from '../tables/channels-acl';
import { ConversationParticipantsACL } from '../tables/conversation-participants-acl';
import { ConversationsACL } from '../tables/conversations-acl';
import { MessageAttachmentsACL } from '../tables/message-attachments-acl';
import { MessagesACL } from '../tables/messages-acl';
import { NotificationPreferencesACL } from '../tables/notification-preferences-acl';
import { OrgMembersACL } from '../tables/org-members-acl';
import { OrganizationsACL } from '../tables/organizations-acl';
import { ReactionCountsACL } from '../tables/reaction-counts-acl';
import { ReactionsACL } from '../tables/reactions-acl';
import { UserGroupMappingsACL } from '../tables/user-group-mappings-acl';
import { UserGroupsACL } from '../tables/user-groups-acl';
import { UserPresenceACL } from '../tables/user-presence-acl';
import { UsersACL } from '../tables/users-acl';
import { NoAcl } from './no-acl';
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
import { FormEntityValuesACL } from '../tables/form-entity-values-acl';
import { DelayedMessagesACL } from '../tables/delayed-messages-acl';

export class ACLFactory {
  /**
   * Get ACL instance for a specific table
   *
   * @param table - The table name to get ACL for
   * @param ctx - Query context with user information
   * @returns ACL instance for the table, or NoOpACL if no specific ACL exists
   */
  static async getACL(
    table: TableName,
    ctx: QueryContext
  ): Promise<BaseACL<any>> {
    switch (table) {
      case 'activities':
        return new ActivitiesACL(ctx);
      case 'apps':
        return new AppsACL(ctx);
      case 'agent_tools_mappings':
        return new NoAcl<'agent_tools_mappings'>(ctx);
      case 'agents':
        return new NoAcl<'agents'>(ctx);
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
      case 'canvas_participants':
        return new CanvasParticipantsACL(ctx);
      case 'canvas_user_status':
        return new CanvasUserStatusACL(ctx);
      case 'canvases':
        return new CanvasesACL(ctx);
      case 'dashboards':
        return new DashboardsACL(ctx);
      case 'dashboard_participants':
        return new DashboardParticipantsACL(ctx);
      case 'dashboard_queries_mapping':
        return new DashboardQueriesMappingACL(ctx);
      case 'queries':
        return new QueriesACL(ctx);
      case 'channel_participants':
        return new ChannelParticipantsACL(ctx);
      case 'channel_stats':
        return new ChannelStatsACL(ctx);
      case 'channels':
        return new ChannelsACL(ctx);
      case 'conversation_participants':
        return new ConversationParticipantsACL(ctx);
      case 'conversations':
        return new ConversationsACL(ctx);
      case 'message_attachments':
        return new MessageAttachmentsACL(ctx);
      case 'messages':
        return new MessagesACL(ctx);
      case 'models':
        return new NoAcl<'models'>(ctx);
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
      case 'tickets':
        return new TicketACl(ctx);
      case 'tools':
        return new NoAcl<'tools'>(ctx);
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
      case 'form_entity_values':
        return new FormEntityValuesACL(ctx);
      case 'rcas':
        return new NoAcl<'rcas'>(ctx);
      case 'impacts':
        return new NoAcl<'impacts'>(ctx);
      case 'coes':
        return new NoAcl<'coes'>(ctx);
      case 'saved_user_configurations':
        return new SavedUserConfigurationsACL(ctx);
      case 'saved_user_configuration_values':
        return new SavedUserConfigurationValuesACL(ctx);
      case 'surface_links':
        return new SurfaceLinksACL(ctx);
      case 'delayed_messages':
        return new DelayedMessagesACL(ctx);
      default:
        return new NoAcl<any>(ctx);
    }
  }
}
