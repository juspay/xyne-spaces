import type { TableName } from './types';
import type { Context } from './../../schema';
import { BaseQueryACL } from './base-acl';

import {
  ActivitiesACL,
  AppsACL,
  InstalledAppsACL,
  CollectionsACL,
  CollectionItemsACL,
  CollectionPermissionsACL,
  BoardComplexityScoresACL,
  BoardsACL,
  BookmarksACL,
  CallParticipantsACL,
  CallsACL,
  CanvasFoldersACL,
  CanvasParticipantsACL,
  CanvasUserStatusACL,
  CanvasesACL,
  CanvasCommentThreadsACL,
  CanvasCommentsACL,
  ChannelDailyRecapsACL,
  ChannelRecapsACL,
  RecapsACL,
  ChannelParticipantsACL,
  ChannelBoardMappingsACL,
  ChannelsACL,
  ChannelSectionsACL,
  ChannelStatsACL,
  ConversationParticipantsACL,
  ConversationsACL,
  MessageAttachmentsACL,
  MessagesACL,
  MessageArtifactsACL,
  NotificationPreferencesACL,
  OrgMembersACL,
  OrganizationsACL,
  ProjectsACL,
  PullRequestsACL,
  ReactionCountsACL,
  ReactionsACL,
  RecurringCallParticipantsACL,
  StagesACL,
  StageTransitionsACL,
  StagePRStatusMappingsACL,
  SubTicketsACL,
  TicketActivitiesACL,
  TicketEntityMappingsACL,
  TicketReferenceMappingsACL,
  TicketSubTicketMappingsACL,
  TicketTagsACL,
  TicketExportsACL,
  ProjectTagsACL,
  TicketTagMappingsACL,
  TicketsACL,
  UserAssignmentStatesACL,
  UserExpertiseMappingsACL,
  UserGroupMappingsACL,
  UserGroupsACL,
  UserPresenceACL,
  RolesACL,
  UserRoleMappingsACL,
  UsersACL,
  UserWorkloadMappingsACL,
  WorkflowsACL,
  ReposACL,
  SdlcEntityLinksACL,
  SdlcArtifactsACL,
  SdlcTracksACL,
  SavedUserConfigurationsACL,
  TicketAssignmentsACL,
  TicketStageEtaACL,
  TicketStageRequestsACL,
  UserProfilesACL,
  UserPreferencesACL,
  FormsACL,
  FormContextMappingsACL,
  FormFieldsACL,
  GlobalFieldsACL,
  FormEntityValuesACL,
  EmailsACL,
  EmailDraftsACL,
  ConversationLabelsACL,
  ConversationLabelMappingsACL,
  TicketUserMailboxACL,
  EmailChannelPreferencesACL,
  BoardSlaPoliciesACL,
  DelayedMessagesACL,
  EmailSignaturesACL,
  InvitationsACL,
  ResourceAccessACL,
  ResourcesACL,
  WorkspacesACL,
  GuestAccessACL,
  AgentToolsMappingsACL,
  AgentsACL,
  ApplicationReleaseTicketsACL,
  ApplicationsACL,
  CanvasVersionsACL,
  ChannelUserStatusACL,
  ClassificationMappingsACL,
  CoesACL,
  CustomEmojisACL,
  DashboardQueriesMappingACL,
  DashboardsACL,
  DraftMessagesACL,
  EmailReadsACL,
  ImpactsACL,
  LinkAccessACL,
  LinksACL,
  LookupValuesACL,
  MerchantsACL,
  ModelsACL,
  ProactiveNudgesACL,
  QueriesACL,
  RcasACL,
  RecurringCallSeriesACL,
  ReleaseAttributionsACL,
  ReleaseChangeTypesACL,
  ReleaseChangesACL,
  ReleaseEventsACL,
  SavedUserConfigurationValuesACL,
  ViewAccessACL,
  StageApproversACL,
  SurfaceLinksACL,
  SurfaceNudgeCountsACL,
  SurfaceNudgesACL,
  ToolsACL,
  WorkspaceOrganizationsACL,
  EntityAccessACL,
  SummaryTemplatesACL,
} from '../tables';
export class QueryACLFactory {
  static getACL<TTable extends TableName>(table: TTable, ctx: Context): BaseQueryACL<TTable> {
    switch (table) {
      case 'activities':
        return new ActivitiesACL(ctx) as BaseQueryACL<TTable>;
      case 'apps':
        return new AppsACL(ctx) as BaseQueryACL<TTable>;
      case 'installed_apps':
        return new InstalledAppsACL(ctx) as BaseQueryACL<TTable>;
      case 'agent_tools_mappings':
        return new AgentToolsMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'agents':
        return new AgentsACL(ctx) as BaseQueryACL<TTable>;
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
      case 'entity_access':
        return new EntityAccessACL(ctx) as BaseQueryACL<TTable>;
      case 'summary_templates':
        return new SummaryTemplatesACL(ctx) as BaseQueryACL<TTable>;
      case 'canvas_folders':
        return new CanvasFoldersACL(ctx) as BaseQueryACL<TTable>;
      case 'canvas_participants':
        return new CanvasParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'canvas_user_status':
        return new CanvasUserStatusACL(ctx) as BaseQueryACL<TTable>;
      case 'canvases':
        return new CanvasesACL(ctx) as BaseQueryACL<TTable>;
      case 'canvas_comment_threads':
        return new CanvasCommentThreadsACL(ctx) as BaseQueryACL<TTable>;
      case 'canvas_comments':
        return new CanvasCommentsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_participants':
        return new ChannelParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_user_status':
        return new ChannelUserStatusACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_sections':
        return new ChannelSectionsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_daily_recaps':
        return new ChannelDailyRecapsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_recaps':
        return new ChannelRecapsACL(ctx) as BaseQueryACL<TTable>;
      case 'channels':
        return new ChannelsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_board_mappings':
        return new ChannelBoardMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'channel_stats':
        return new ChannelStatsACL(ctx) as BaseQueryACL<TTable>;
      case 'conversation_participants':
        return new ConversationParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'conversations':
        return new ConversationsACL(ctx) as BaseQueryACL<TTable>;
      case 'message_attachments':
        return new MessageAttachmentsACL(ctx) as BaseQueryACL<TTable>;
      case 'models':
        return new ModelsACL(ctx) as BaseQueryACL<TTable>;
      case 'messages':
        return new MessagesACL(ctx) as BaseQueryACL<TTable>;
      case 'message_artifacts':
        return new MessageArtifactsACL(ctx) as BaseQueryACL<TTable>;
      case 'notification_preferences':
        return new NotificationPreferencesACL(ctx) as BaseQueryACL<TTable>;
      case 'org_members':
        return new OrgMembersACL(ctx) as BaseQueryACL<TTable>;
      case 'organizations':
        return new OrganizationsACL(ctx) as BaseQueryACL<TTable>;
      case 'recaps':
        return new RecapsACL(ctx) as unknown as BaseQueryACL<TTable>;
      case 'projects':
        return new ProjectsACL(ctx) as BaseQueryACL<TTable>;
      case 'pull_requests':
        return new PullRequestsACL(ctx) as BaseQueryACL<TTable>;
      case 'reaction_counts':
        return new ReactionCountsACL(ctx) as BaseQueryACL<TTable>;
      case 'reactions':
        return new ReactionsACL(ctx) as BaseQueryACL<TTable>;
      case 'recurring_call_participants':
        return new RecurringCallParticipantsACL(ctx) as BaseQueryACL<TTable>;
      case 'stages':
        return new StagesACL(ctx) as BaseQueryACL<TTable>;
      case 'stage_transitions':
        return new StageTransitionsACL(ctx) as BaseQueryACL<TTable>;
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
      case 'ticket_exports':
        return new TicketExportsACL(ctx) as BaseQueryACL<TTable>;
      case 'project_tags':
        return new ProjectTagsACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_tag_mappings':
        return new TicketTagMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'tools':
        return new ToolsACL(ctx) as BaseQueryACL<TTable>;
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
      case 'roles':
        return new RolesACL(ctx) as BaseQueryACL<TTable>;
      case 'user_role_mappings':
        return new UserRoleMappingsACL(ctx) as BaseQueryACL<TTable>;
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
      case 'ticket_stage_requests':
        return new TicketStageRequestsACL(ctx) as BaseQueryACL<TTable>;
      case 'user_workload_mappings':
        return new UserWorkloadMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'users':
        return new UsersACL(ctx) as BaseQueryACL<TTable>;
      case 'workflows':
        return new WorkflowsACL(ctx) as BaseQueryACL<TTable>;
      case 'repos':
        return new ReposACL(ctx) as BaseQueryACL<TTable>;
      case 'sdlc_entity_links':
        return new SdlcEntityLinksACL(ctx) as BaseQueryACL<TTable>;
      case 'sdlc_artifacts':
        return new SdlcArtifactsACL(ctx) as BaseQueryACL<TTable>;
      case 'sdlc_tracks':
        return new SdlcTracksACL(ctx) as BaseQueryACL<TTable>;
      case 'saved_user_configurations':
        return new SavedUserConfigurationsACL(ctx) as BaseQueryACL<TTable>;
      case 'saved_user_configuration_values':
        return new SavedUserConfigurationValuesACL(ctx) as BaseQueryACL<TTable>;
      case 'view_access':
        return new ViewAccessACL(ctx) as BaseQueryACL<TTable>;
      case 'delayed_messages':
        return new DelayedMessagesACL(ctx) as BaseQueryACL<TTable>;
      case 'collections':
        return new CollectionsACL(ctx) as BaseQueryACL<TTable>;
      case 'collection_items':
        return new CollectionItemsACL(ctx) as BaseQueryACL<TTable>;
      case 'collection_permissions':
        return new CollectionPermissionsACL(ctx) as BaseQueryACL<TTable>;
      case 'email_signatures':
        return new EmailSignaturesACL(ctx) as BaseQueryACL<TTable>;
      case 'invitations':
        return new InvitationsACL(ctx) as BaseQueryACL<TTable>;
      case 'resource_access':
        return new ResourceAccessACL(ctx) as BaseQueryACL<TTable>;
      case 'resources':
        return new ResourcesACL(ctx) as BaseQueryACL<TTable>;
      case 'workspaces':
        return new WorkspacesACL(ctx) as BaseQueryACL<TTable>;
      case 'application_release_tickets':
        return new ApplicationReleaseTicketsACL(ctx) as BaseQueryACL<TTable>;
      case 'applications':
        return new ApplicationsACL(ctx) as BaseQueryACL<TTable>;
      case 'canvas_versions':
        return new CanvasVersionsACL(ctx) as BaseQueryACL<TTable>;
      case 'classification_mappings':
        return new ClassificationMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'coes':
        return new CoesACL(ctx) as BaseQueryACL<TTable>;
      case 'custom_emojis':
        return new CustomEmojisACL(ctx) as BaseQueryACL<TTable>;
      case 'dashboard_queries_mapping':
        return new DashboardQueriesMappingACL(ctx) as BaseQueryACL<TTable>;
      case 'dashboards':
        return new DashboardsACL(ctx) as BaseQueryACL<TTable>;
      case 'draft_messages':
        return new DraftMessagesACL(ctx) as BaseQueryACL<TTable>;
      case 'email_reads':
        return new EmailReadsACL(ctx) as BaseQueryACL<TTable>;
      case 'impacts':
        return new ImpactsACL(ctx) as BaseQueryACL<TTable>;
      case 'link_access':
        return new LinkAccessACL(ctx) as BaseQueryACL<TTable>;
      case 'links':
        return new LinksACL(ctx) as BaseQueryACL<TTable>;
      case 'lookup_values':
        return new LookupValuesACL(ctx) as BaseQueryACL<TTable>;
      case 'merchants':
        return new MerchantsACL(ctx) as BaseQueryACL<TTable>;
      case 'proactive_nudges':
        return new ProactiveNudgesACL(ctx) as BaseQueryACL<TTable>;
      case 'queries':
        return new QueriesACL(ctx) as BaseQueryACL<TTable>;
      case 'rcas':
        return new RcasACL(ctx) as BaseQueryACL<TTable>;
      case 'recurring_call_series':
        return new RecurringCallSeriesACL(ctx) as BaseQueryACL<TTable>;
      case 'release_attributions':
        return new ReleaseAttributionsACL(ctx) as BaseQueryACL<TTable>;
      case 'release_change_types':
        return new ReleaseChangeTypesACL(ctx) as BaseQueryACL<TTable>;
      case 'release_changes':
        return new ReleaseChangesACL(ctx) as BaseQueryACL<TTable>;
      case 'release_events':
        return new ReleaseEventsACL(ctx) as BaseQueryACL<TTable>;
      case 'stage_approvers':
        return new StageApproversACL(ctx) as BaseQueryACL<TTable>;
      case 'surface_links':
        return new SurfaceLinksACL(ctx) as BaseQueryACL<TTable>;
      case 'surface_nudge_counts':
        return new SurfaceNudgeCountsACL(ctx) as BaseQueryACL<TTable>;
      case 'surface_nudges':
        return new SurfaceNudgesACL(ctx) as BaseQueryACL<TTable>;
      case 'workspace_organizations':
        return new WorkspaceOrganizationsACL(ctx) as BaseQueryACL<TTable>;
      case 'emails':
        return new EmailsACL(ctx) as BaseQueryACL<TTable>;
      case 'email_drafts':
        return new EmailDraftsACL(ctx) as BaseQueryACL<TTable>;
      case 'conversation_labels':
        return new ConversationLabelsACL(ctx) as BaseQueryACL<TTable>;
      case 'conversation_label_mappings':
        return new ConversationLabelMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'ticket_user_mailbox':
        return new TicketUserMailboxACL(ctx) as BaseQueryACL<TTable>;
      case 'email_channel_preferences':
        return new EmailChannelPreferencesACL(ctx) as BaseQueryACL<TTable>;
      case 'board_sla_policies':
        return new BoardSlaPoliciesACL(ctx) as BaseQueryACL<TTable>;
      case 'forms':
        return new FormsACL(ctx) as BaseQueryACL<TTable>;
      case 'form_entity_values':
        return new FormEntityValuesACL(ctx) as BaseQueryACL<TTable>;
      case 'form_fields':
        return new FormFieldsACL(ctx) as BaseQueryACL<TTable>;
      case 'global_fields':
        return new GlobalFieldsACL(ctx) as BaseQueryACL<TTable>;
      case 'forms_context_mapping':
        return new FormContextMappingsACL(ctx) as BaseQueryACL<TTable>;
      case 'guest_access':
        return new GuestAccessACL(ctx) as BaseQueryACL<TTable>;
    }
  }
}
