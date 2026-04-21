import type { TableName } from './types';
import type {Context} from './../../schema'
import { BaseQueryACL } from './base-acl';

import {
  ActivitiesACL,
  BoardComplexityScoresACL,
  BoardsACL,
  BookmarksACL,
  CallParticipantsACL,
  CallsACL,
  CanvasParticipantsACL,
  CanvasesACL,
  ChannelDailyRecapsACL,
  ChannelParticipantsACL,
  ChannelsACL,
  ChannelStatsACL,
  ConversationParticipantsACL,
  ConversationsACL,
  MessageAttachmentsACL,
  MessagesACL,
  NotificationPreferencesACL,
  OrgMembersACL,
  OrganizationsACL,
  ProjectsACL,
  PullRequestsACL,
  ReactionCountsACL,
  ReactionsACL,
  StagesACL,
  StagePRStatusMappingsACL,
  SubTicketsACL,
  TicketActivitiesACL,
  TicketEntityMappingsACL,
  TicketReferenceMappingsACL,
  TicketSubTicketMappingsACL,
  TicketTagsACL,
  TicketsACL,
  UserAssignmentStatesACL,
  UserExpertiseMappingsACL,
  UserGroupMappingsACL,
  UserGroupsACL,
  UserPresenceACL,
  UsersACL,
  UserWorkloadMappingsACL,
  WorkflowExecutionsACL,
  WorkflowsACL,
  ReposACL,
  SavedUserConfigurationsACL,
  TicketAssignmentsACL,
  TicketStageEtaACL,
  UserProfilesACL,
  UserPreferencesACL,
  FormsACL,
  FormContextMappingsACL,
  FormFieldsACL,
  FormEntityValuesACL,
} from '../tables';
export class QueryACLFactory {
  static getACL<TTable extends TableName>(
    table: TTable,
    ctx: Context
  ): BaseQueryACL<TTable> {
    switch (table) {
      case 'activities':
        return new ActivitiesACL(ctx) as BaseQueryACL<TTable>;
      case 'agent_tools_mappings':
        return new BaseQueryACL(ctx, table);
      case 'agents':
        return new BaseQueryACL(ctx, table);
      case 'board_complexity_scores':
        return new BoardComplexityScoresACL(ctx) as BaseQueryACL<TTable>;
      case 'boards':
        return new BoardsACL(ctx) as BaseQueryACL<TTable>;
      case 'bookmarks':
        return new BookmarksACL(ctx) as BaseQueryACL<TTable>;
      case 'call_participants':
        return new CallParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'calls':
        return new CallsACL(ctx) as BaseQueryACL<TTable>;
      case 'canvas_participants':
        return new CanvasParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'canvases':
        return new CanvasesACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_participants':
        return new ChannelParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_user_status':
        return new BaseQueryACL(ctx, table);
      case 'channel_daily_recaps':
        return new ChannelDailyRecapsACL(ctx) as BaseQueryACL<TTable>;
      case 'channels':
        return new ChannelsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_stats':
        return new ChannelStatsACL(ctx) as BaseQueryACL<TTable>;
      case 'conversation_participants':
        return new ConversationParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'conversations':
        return new ConversationsACL(ctx) as BaseQueryACL<TTable>;
      case 'message_attachments':
        return new MessageAttachmentsACL(ctx) as BaseQueryACL<TTable>;
      case 'models':
        return new BaseQueryACL(ctx, table);
      case 'messages':
        return new MessagesACL(ctx) as BaseQueryACL<TTable>;
      case 'notification_preferences':
        return new NotificationPreferencesACL(ctx) as BaseQueryACL<TTable>;
      case 'org_members':
        return new OrgMembersACL(ctx) as BaseQueryACL<TTable>;
      case 'organizations':
        return new OrganizationsACL(ctx) as BaseQueryACL<TTable>;
      case 'projects':
        return new ProjectsACL(ctx) as BaseQueryACL<TTable>;
      case 'pull_requests':
        return new PullRequestsACL(ctx) as BaseQueryACL<TTable>;
      case 'reaction_counts':
        return new ReactionCountsACL(ctx) as BaseQueryACL<TTable>;
      case 'reactions':
        return new ReactionsACL(ctx) as BaseQueryACL<TTable>;
      case 'stages':
        return new StagesACL(ctx) as BaseQueryACL<TTable>;
      case 'stage_pr_status_mappings':
        return new StagePRStatusMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'sub_tickets':
        return new SubTicketsACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_activities':
        return new TicketActivitiesACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_entity_mappings':
        return new TicketEntityMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_reference_mappings':
        return new TicketReferenceMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_sub_ticket_mappings':
        return new TicketSubTicketMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_tags':
        return new TicketTagsACL(ctx) as BaseQueryACL<TTable>;
      case 'tools':
        return new BaseQueryACL(ctx, table);
      case 'tickets':
        return new TicketsACL(ctx) as BaseQueryACL<TTable>;
      case 'user_assignment_states':
        return new UserAssignmentStatesACL(ctx) as BaseQueryACL<TTable>;
      case 'user_expertise_mappings':
        return new UserExpertiseMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'user_group_mappings':
        return new UserGroupMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'user_groups':
        return new UserGroupsACL(ctx) as BaseQueryACL<TTable>;
      case 'user_presence':
        return new UserPresenceACL(ctx) as BaseQueryACL<TTable>;
      case 'user_profiles':
        return new UserProfilesACL(ctx) as BaseQueryACL<TTable>;
      case 'user_preferences':
        return new UserPreferencesACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_assignments':
        return new TicketAssignmentsACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_stage_eta':
        return new TicketStageEtaACL(ctx) as BaseQueryACL<TTable>;
      case 'user_workload_mappings':
        return new UserWorkloadMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'users':
        return new UsersACL(ctx) as BaseQueryACL<TTable>;
      case 'workflow_executions':
        return new WorkflowExecutionsACL(ctx) as BaseQueryACL<TTable>;
      case 'workflows':
        return new WorkflowsACL(ctx) as BaseQueryACL<TTable>;
      case 'repos':
        return new ReposACL(ctx) as BaseQueryACL<TTable>;
      case 'saved_user_configurations':
        return new SavedUserConfigurationsACL(ctx) as BaseQueryACL<TTable>;
      case 'saved_user_configuration_values':
        return new BaseQueryACL(ctx, table);
      default:
        return new BaseQueryACL(ctx, table);
      case 'emails':
        return new BaseQueryACL(ctx, table);
      case 'email_drafts':
        return new BaseQueryACL(ctx, table);
      case 'forms':
        return new FormsACL(ctx) as BaseQueryACL<TTable>;
      case 'form_entity_values':
        return new FormEntityValuesACL(ctx) as BaseQueryACL<TTable>;
      case 'form_fields':
        return new FormFieldsACL(ctx) as BaseQueryACL<TTable>;
      case 'forms_context_mapping':
        return new FormContextMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'dashboards':
      case 'queries':
      case 'dashboard_queries_mapping':
        return new BaseQueryACL(ctx, table);
    }
  }
}
