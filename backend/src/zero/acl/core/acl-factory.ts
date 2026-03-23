import type { QueryContext, TableName } from './types';
import { BaseACL } from './base-acl';
import { ActivitiesACL } from '../tables/activities-acl';
import { CallParticipantsACL } from '../tables/call-participants-acl';
import { CallsACL } from '../tables/calls-acl';
import { CanvasParticipantsACL } from '../tables/canvas-participants-acl';
import { CanvasesACL } from '../tables/canvases-acl';
import { ChannelParticipantsACL } from '../tables/channel-participants-acl';
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
import { ChannelUserStatusACL } from '../tables/channel-user-status-acl';
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
      case 'call_participants':
        return new CallParticipantsACL(ctx);
      case 'calls':
        return new CallsACL(ctx);
      case 'canvas_participants':
        return new CanvasParticipantsACL(ctx);
      case 'canvases':
        return new CanvasesACL(ctx);
      case 'channel_participants':
        return new ChannelParticipantsACL(ctx);
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
      case 'user_profiles':
        return new NoAcl<'user_profiles'>(ctx);
      case 'rcas':
        return new NoAcl<'rcas'>(ctx);
      case 'impacts':
        return new NoAcl<'impacts'>(ctx);
      case 'coes':
        return new NoAcl<'coes'>(ctx);
      case 'surface_links':
        return new SurfaceLinksACL(ctx);
      default:
        return new NoAcl<any>(ctx);
    }
  }
}
