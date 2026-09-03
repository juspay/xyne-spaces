import { PrismaClient, Prisma } from '@prisma/client'
import { BaseQueryACL, ACLContext } from './base-acl'
import {
  ActivitiesACL,
  AppsACL,
  InstalledAppsACL,
  AgentsACL,
  AgentStepsACL,
  AgentToolsMappingsACL,
  ApplicationReleaseTicketsACL,
  ApplicationsACL,
  BoardComplexityScoresACL,
  BoardsACL,
  BookmarksACL,
  CallParticipantsACL,
  CallsACL,
  CanvasesACL,
  CanvasParticipantsACL,
  CanvasVersionsACL,
  CanvasCommentsACL,
  CanvasCommentThreadsACL,
  ChannelParticipantsACL,
  ChannelBoardMappingsACL,
  ChannelsACL,
  ChannelStatsACL,
  ChannelUserStatusACL,
  ClassificationMappingsACL,
  CoesACL,
  ConversationParticipantsACL,
  ConversationsACL,
  CustomEmojisACL,
  DashboardQueriesMappingACL,
  DashboardsACL,
  DraftMessagesACL,
  EmailDraftsACL,
  ScheduledMessagesACL,
  EmailReadsACL,
  EmailsACL,
  ExternalStepResponsesACL,
  FormContextMappingsACL,
  FormEntityValuesACL,
  FormFieldsACL,
  FormsACL,
  GlobalFieldsACL,
  ImpactsACL,
  InvitationsACL,
  OrganizationDomainsACL,
  OrgLLMServiceAccountCredentialsACL,
  LinkAccessACL,
  LinksACL,
  LookupValuesACL,
  MerchantsACL,
  MessageAttachmentsACL,
  MessagesACL,
  ModelsACL,
  NotificationPreferencesACL,
  NotificationsACL,
  OrganizationsACL,
  OrgMembersACL,
  ProactiveNudgesACL,
  ProjectsACL,
  QuestionnaireResponsesACL,
  PullRequestsACL,
  QueriesACL,
  RcasACL,
  ReactionCountsACL,
  ReactionsACL,
  RecurringCallSeriesACL,
  ReleaseAttributionsACL,
  ReleaseChangesACL,
  ReleaseChangeTypesACL,
  ReleaseEventsACL,
  ReposACL,
  RolesACL,
  SavedUserConfigurationsACL,
  SavedUserConfigurationValuesACL,
  StageApproversACL,
  StagesACL,
  SubTicketsACL,
  SurfaceLinksACL,
  SurfaceNudgeCountsACL,
  SurfaceNudgesACL,
  TicketActivitiesACL,
  TicketAssignmentsACL,
  TicketEntityMappingsACL,
  TicketReferenceMappingsACL,
  TicketsACL,
  TicketStageEtaACL,
  TicketSubTicketMappingsACL,
  TicketTagsACL,
  ToolsACL,
  UserAssignmentStatesACL,
  UserExpertiseMappingsACL,
  UserGroupMappingsACL,
  UserGroupsACL,
  UserPreferencesACL,
  UserPresenceACL,
  UserProfilesACL,
  UserRoleMappingsACL,
  UsersACL,
  UserWorkloadMappingsACL,
  WorkflowExecutionsACL,
  WorkflowsACL,
  WorkflowStepsACL,
  WorkspaceOrganizationsACL,
  WorkspacesACL,
  BoardSlaPoliciesACL,
  CanvasFoldersACL,
  CanvasUserStatusACL,
  ChannelDailyRecapsACL,
  ChannelRecapsACL,
  ChannelSectionsACL,
  CollectionsACL,
  CollectionItemsACL,
  CollectionPermissionsACL,
  ConversationLabelsACL,
  ConversationLabelMappingsACL,
  DelayedMessagesACL,
  EmailChannelPreferencesACL,
  EmailSignaturesACL,
  ProjectTagsACL,
  RecapsACL,
  RecurringCallParticipantsACL,
  ResourceAccessACL,
  StagePRStatusMappingsACL,
  StageTransitionsACL,
  TicketStageRequestsACL,
  TicketTagMappingsACL,
  TicketUserMailboxACL,
  UnscopedACL,
} from './tables'
import { UserActivityEventsAcl } from './tables/user_activity_acl'

export class ACLFactory {
  static getACL(
    modelName: Uncapitalize<Prisma.ModelName>,
    ctx: ACLContext,
    prisma: PrismaClient,
  ): BaseQueryACL {
    switch (modelName) {
    case 'activity':
      return new ActivitiesACL(ctx, prisma)
    case 'agent':
      return new AgentsACL(ctx, prisma)
    case 'agentStep':
      return new AgentStepsACL(ctx, prisma)
    case 'agentToolsMapping':
      return new AgentToolsMappingsACL(ctx, prisma)
    case 'application':
      return new ApplicationsACL(ctx, prisma)
    case 'applicationReleaseTicket':
      return new ApplicationReleaseTicketsACL(ctx, prisma)
    case 'board':
      return new BoardsACL(ctx, prisma)
    case 'boardComplexityScore':
      return new BoardComplexityScoresACL(ctx, prisma)
    case 'bookmark':
      return new BookmarksACL(ctx, prisma)
    case 'call':
      return new CallsACL(ctx, prisma)
    case 'callParticipant':
      return new CallParticipantsACL(ctx, prisma)
    case 'canvas':
      return new CanvasesACL(ctx, prisma)
    case 'canvasParticipant':
      return new CanvasParticipantsACL(ctx, prisma)
    case 'canvasVersion':
      return new CanvasVersionsACL(ctx, prisma)
    case 'canvasComment':
      return new CanvasCommentsACL(ctx, prisma)
    case 'canvasCommentThread':
      return new CanvasCommentThreadsACL(ctx, prisma)
    // Both carry workspaceId, so the base clause ({ workspaceId }) is the whole rule.
    case 'entityAccess':
      return new BaseQueryACL(ctx, prisma)
    case 'summaryTemplate':
      return new BaseQueryACL(ctx, prisma)
    // Radar execution engine: non_zero derived data, workspace-scoped; the
    // feed API layers thread-membership checks in its own queries.
    case 'executionItem':
      return new BaseQueryACL(ctx, prisma)
    case 'executionThreadState':
      return new BaseQueryACL(ctx, prisma)
    case 'executionItemMutation':
      return new BaseQueryACL(ctx, prisma)
    case 'executionRunLog':
      return new BaseQueryACL(ctx, prisma)
    case 'radarTeam':
      return new BaseQueryACL(ctx, prisma)
    case 'channel':
      return new ChannelsACL(ctx, prisma)
    case 'channelBoardMapping':
      return new ChannelBoardMappingsACL(ctx, prisma)
    case 'channelParticipant':
      return new ChannelParticipantsACL(ctx, prisma)
    case 'channelStats':
      return new ChannelStatsACL(ctx, prisma)
    case 'channelUserStatus':
      return new ChannelUserStatusACL(ctx, prisma)
    case 'classificationMapping':
      return new ClassificationMappingsACL(ctx, prisma)
    case 'cOE':
      return new CoesACL(ctx, prisma)
    case 'conversation':
      return new ConversationsACL(ctx, prisma)
    case 'conversationParticipant':
      return new ConversationParticipantsACL(ctx, prisma)
    case 'customEmoji':
      return new CustomEmojisACL(ctx, prisma)
    case 'dashboard':
      return new DashboardsACL(ctx, prisma)
    case 'dashboardQueryMapping':
      return new DashboardQueriesMappingACL(ctx, prisma)
    case 'draftMessage':
      return new DraftMessagesACL(ctx, prisma)
    case 'email':
      return new EmailsACL(ctx, prisma)
    case 'emailRead':
      return new EmailReadsACL(ctx, prisma)
    case 'externalStepResponse':
      return new ExternalStepResponsesACL(ctx, prisma)
    case 'form':
      return new FormsACL(ctx, prisma)
    case 'formContextMapping':
      return new FormContextMappingsACL(ctx, prisma)
    case 'formEntityValues':
      return new FormEntityValuesACL(ctx, prisma)
    case 'formFields':
      return new FormFieldsACL(ctx, prisma)
    case 'globalField':
      return new GlobalFieldsACL(ctx, prisma)
    case 'impact':
      return new ImpactsACL(ctx, prisma)
    case 'invitation':
      return new InvitationsACL(ctx, prisma)
    case 'link':
      return new LinksACL(ctx, prisma)
    case 'linkAccess':
      return new LinkAccessACL(ctx, prisma)
    case 'lookupValue':
      return new LookupValuesACL(ctx, prisma)
    case 'merchant':
      return new MerchantsACL(ctx, prisma)
    case 'message':
      return new MessagesACL(ctx, prisma)
    case 'messageArtifact':
      return new BaseQueryACL(ctx, prisma)
    case 'messageAttachment':
      return new MessageAttachmentsACL(ctx, prisma)
    case 'model':
      return new ModelsACL(ctx, prisma)
    case 'notification':
      return new NotificationsACL(ctx, prisma)
    case 'notificationPreference':
      return new NotificationPreferencesACL(ctx, prisma)
    case 'organization':
      return new OrganizationsACL(ctx, prisma)
    case 'orgMember':
      return new OrgMembersACL(ctx, prisma)
    case 'proactiveNudge':
      return new ProactiveNudgesACL(ctx, prisma)
    case 'project':
      return new ProjectsACL(ctx, prisma)
    case 'pullRequests':
      return new PullRequestsACL(ctx, prisma)
    case 'query':
      return new QueriesACL(ctx, prisma)
    case 'questionnaireResponse':
      return new QuestionnaireResponsesACL(ctx, prisma)
    case 'rCA':
      return new RcasACL(ctx, prisma)
    case 'reaction':
      return new ReactionsACL(ctx, prisma)
    case 'reactionCount':
      return new ReactionCountsACL(ctx, prisma)
    case 'recurringCallSeries':
      return new RecurringCallSeriesACL(ctx, prisma)
    case 'releaseAttribution':
      return new ReleaseAttributionsACL(ctx, prisma)
    case 'releaseChange':
      return new ReleaseChangesACL(ctx, prisma)
    case 'releaseChangeType':
      return new ReleaseChangeTypesACL(ctx, prisma)
    case 'releaseEvent':
      return new ReleaseEventsACL(ctx, prisma)
    case 'releaseRepository':
      // non_zero table (not Zero-synced); tenant scoping is enforced inline in
      // the route/repo, so the generic ACL suffices for switch exhaustiveness.
      return new BaseQueryACL(ctx, prisma)
    case 'repo':
      return new ReposACL(ctx, prisma)
    case 'sdlcEntityLink':
      return new BaseQueryACL(ctx, prisma)
    case 'sdlcArtifact':
      return new BaseQueryACL(ctx, prisma)
    case 'sdlcTrack':
      return new BaseQueryACL(ctx, prisma)
    case 'role':
      return new RolesACL(ctx, prisma)
    case 'savedUserConfiguration':
      return new SavedUserConfigurationsACL(ctx, prisma)
    case 'savedUserConfigurationValue':
      return new SavedUserConfigurationValuesACL(ctx, prisma)
    case 'stage':
      return new StagesACL(ctx, prisma)
    case 'stageApprovers':
      return new StageApproversACL(ctx, prisma)
    case 'subTicket':
      return new SubTicketsACL(ctx, prisma)
    case 'surfaceLink':
      return new SurfaceLinksACL(ctx, prisma)
    case 'surfaceNudge':
      return new SurfaceNudgesACL(ctx, prisma)
    case 'surfaceNudgeCount':
      return new SurfaceNudgeCountsACL(ctx, prisma)
    case 'ticket':
      return new TicketsACL(ctx, prisma)
    case 'ticketActivity':
      return new TicketActivitiesACL(ctx, prisma)
    case 'ticketAssignment':
      return new TicketAssignmentsACL(ctx, prisma)
    case 'ticketEntityMapping':
      return new TicketEntityMappingsACL(ctx, prisma)
    case 'ticketReferenceMapping':
      return new TicketReferenceMappingsACL(ctx, prisma)
    case 'ticketStageEta':
      return new TicketStageEtaACL(ctx, prisma)
    case 'ticketSubTicketMapping':
      return new TicketSubTicketMappingsACL(ctx, prisma)
    case 'ticketTag':
      return new TicketTagsACL(ctx, prisma)
    case 'tool':
      return new ToolsACL(ctx, prisma)
    case 'user':
      return new UsersACL(ctx, prisma)
    case 'userActivityEvent':
      return new UserActivityEventsAcl(ctx, prisma)
    case 'userAssignmentState':
      return new UserAssignmentStatesACL(ctx, prisma)
    case 'userExpertiseMapping':
      return new UserExpertiseMappingsACL(ctx, prisma)
    case 'userGroup':
      return new UserGroupsACL(ctx, prisma)
    case 'userGroupMapping':
      return new UserGroupMappingsACL(ctx, prisma)
    case 'userPreference':
      return new UserPreferencesACL(ctx, prisma)
    case 'userPresence':
      return new UserPresenceACL(ctx, prisma)
    case 'userProfile':
      return new UserProfilesACL(ctx, prisma)
    case 'userRoleMapping':
      return new UserRoleMappingsACL(ctx, prisma)
    case 'userWorkloadMapping':
      return new UserWorkloadMappingsACL(ctx, prisma)
    case 'workflow':
      return new WorkflowsACL(ctx, prisma)
    case 'workflowExecution':
      return new WorkflowExecutionsACL(ctx, prisma)
    case 'workflowStep':
      return new WorkflowStepsACL(ctx, prisma)
    case 'workspace':
      return new WorkspacesACL(ctx, prisma)
    case 'workspaceOrganization':
      return new WorkspaceOrganizationsACL(ctx, prisma)
    case 'aCLAuditLog':
      return new BaseQueryACL(ctx, prisma)
    case 'activityAlias':
      return new UnscopedACL(ctx, prisma)
    case 'apiKey':
      return new BaseQueryACL(ctx, prisma)
    case 'appCommand':
      return new BaseQueryACL(ctx, prisma)
    case 'appIncomingWebhook':
      return new BaseQueryACL(ctx, prisma)
    case 'appPermission':
      return new BaseQueryACL(ctx, prisma)
    case 'apps':
      return new AppsACL(ctx, prisma)
    case 'availableAppPermission':
      return new UnscopedACL(ctx, prisma)
    case 'boardSlaPolicy':
      return new BoardSlaPoliciesACL(ctx, prisma)
    case 'browserNotificationSubscription':
      return new BaseQueryACL(ctx, prisma)
    case 'callMessage':
      return new BaseQueryACL(ctx, prisma)
    case 'callRecording':
      return new BaseQueryACL(ctx, prisma)
    case 'canvasFolder':
      return new CanvasFoldersACL(ctx, prisma)
    case 'canvasUserStatus':
      return new CanvasUserStatusACL(ctx, prisma)
    case 'channelDailyRecap':
      return new ChannelDailyRecapsACL(ctx, prisma)
    case 'channelRecap':
      return new ChannelRecapsACL(ctx, prisma)
    case 'channelSection':
      return new ChannelSectionsACL(ctx, prisma)
    case 'collection':
      return new CollectionsACL(ctx, prisma)
    case 'collectionItem':
      return new CollectionItemsACL(ctx, prisma)
    case 'collectionPermission':
      return new CollectionPermissionsACL(ctx, prisma)
    case 'conversationLabel':
      return new ConversationLabelsACL(ctx, prisma)
    case 'conversationLabelMapping':
      return new ConversationLabelMappingsACL(ctx, prisma)
    case 'dashboardActivity':
      return new BaseQueryACL(ctx, prisma)
    case 'dashboardParticipant':
      return new BaseQueryACL(ctx, prisma)
    case 'dataSource':
      return new BaseQueryACL(ctx, prisma)
    case 'dataSourceColumn':
      return new BaseQueryACL(ctx, prisma)
    case 'dataSourceRelationship':
      return new BaseQueryACL(ctx, prisma)
    case 'dataSourceTable':
      return new BaseQueryACL(ctx, prisma)
    case 'delayedMessage':
      return new DelayedMessagesACL(ctx, prisma)
    case 'doclingAsyncFile':
      return new UnscopedACL(ctx, prisma)
    case 'doclingAsyncPart':
      return new UnscopedACL(ctx, prisma)
    case 'dynamicDashboard':
      return new BaseQueryACL(ctx, prisma)
    case 'dynamicDashboardQuery':
      return new BaseQueryACL(ctx, prisma)
    case 'dynamicDashboardQueryMapping':
      return new BaseQueryACL(ctx, prisma)
    case 'emailChannelPreference':
      return new EmailChannelPreferencesACL(ctx, prisma)
    case 'emailDraft':
      return new EmailDraftsACL(ctx, prisma)
    case 'emailSignature':
      return new EmailSignaturesACL(ctx, prisma)
    case 'externalMessage':
      return new BaseQueryACL(ctx, prisma)
    case 'externalSource':
      return new BaseQueryACL(ctx, prisma)
    case 'installedAppCommand':
      return new BaseQueryACL(ctx, prisma)
    case 'installedAppPermission':
      return new BaseQueryACL(ctx, prisma)
    case 'installedApps':
      return new InstalledAppsACL(ctx, prisma)
    case 'knowledgeDocument':
      return new BaseQueryACL(ctx, prisma)
    case 'prThreadLink':
      return new BaseQueryACL(ctx, prisma)
    case 'projectTag':
      return new ProjectTagsACL(ctx, prisma)
    case 'recap':
      return new RecapsACL(ctx, prisma)
    case 'recurringCallParticipant':
      return new RecurringCallParticipantsACL(ctx, prisma)
    case 'resource':
      return new UnscopedACL(ctx, prisma)
    case 'resourceAccess':
      return new ResourceAccessACL(ctx, prisma)
    case 'scheduledMessage':
      return new ScheduledMessagesACL(ctx, prisma)
    case 'sessionRecordingFile':
      return new BaseQueryACL(ctx, prisma)
    case 'stagePRStatusMapping':
      return new StagePRStatusMappingsACL(ctx, prisma)
    case 'stageTransition':
      return new StageTransitionsACL(ctx, prisma)
    case 'tag':
      return new BaseQueryACL(ctx, prisma)
    case 'tagsConfig':
      return new BaseQueryACL(ctx, prisma)
    // Workspace-scoped config, reached only through the thread-type-vocabulary API, which
    // does its own admin check. Listed so the switch stays exhaustive over ModelName.
    case 'threadTypeVocabulary':
      return new BaseQueryACL(ctx, prisma)
    case 'teamIntelligenceIngestionBatchV2':
      return new UnscopedACL(ctx, prisma)
    case 'teamIntelligenceOrgSummaryV2':
      return new UnscopedACL(ctx, prisma)
    case 'teamIntelligenceTeamSummaryV2':
      return new UnscopedACL(ctx, prisma)
    case 'teamIntelligenceUserIngestionV2':
      return new UnscopedACL(ctx, prisma)
    case 'ticketStageRequest':
      return new TicketStageRequestsACL(ctx, prisma)
    case 'ticketTagMapping':
      return new TicketTagMappingsACL(ctx, prisma)
    case 'ticketUserMailbox':
      return new TicketUserMailboxACL(ctx, prisma)
    case 'userExternalToken':
      return new BaseQueryACL(ctx, prisma)
    case 'userSession':
      return new BaseQueryACL(ctx, prisma)
    case 'userSkill':
      return new BaseQueryACL(ctx, prisma)
    case 'vespaInsertionLogs':
      return new UnscopedACL(ctx, prisma)
    case 'workflowCredential':
      return new BaseQueryACL(ctx, prisma)
    case 'workflowFolder':
      return new BaseQueryACL(ctx, prisma)
    case 'workflowExecutionLock':
      return new BaseQueryACL(ctx, prisma)
    case 'workflowExecutionState':
      return new BaseQueryACL(ctx, prisma)
    case 'workflowExecutionUsers':
      return new BaseQueryACL(ctx, prisma)
    case 'workflowKnowledge':
      return new BaseQueryACL(ctx, prisma)
    case 'workflowMapping':
      return new UnscopedACL(ctx, prisma)
    case 'organizationDomain':
      return new OrganizationDomainsACL(ctx, prisma)
    case 'workspaceJoinRequest':
      return new BaseQueryACL(ctx, prisma)
    case 'aiProvisioningStatus':
      return new UnscopedACL(ctx, prisma)
    case 'orgLLMServiceAccountCredential':
      return new OrgLLMServiceAccountCredentialsACL(ctx, prisma)
    case 'guestAccess':
      return new BaseQueryACL(ctx, prisma)
    case 'entity':
      return new BaseQueryACL(ctx, prisma)
    case 'ticketExport':
      return new BaseQueryACL(ctx, prisma)
    case 'entityAlias':
      return new BaseQueryACL(ctx, prisma)
    case 'deskAutoLabelRuleReference':
      return new BaseQueryACL(ctx, prisma)
    }
  }
}
