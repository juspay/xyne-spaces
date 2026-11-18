import { Prisma } from '@prisma/client'
import {
  ActivitiesACL,
  AgentsACL,
  AgentStepsACL,
  AgentToolsMappingsACL,
  ApplicationReleaseTicketsACL,
  ApplicationsACL,
  BoardComplexityScoresACL,
  BoardsACL,
  BoardSlaPoliciesACL,
  CallParticipantsACL,
  CallsACL,
  CanvasCommentsACL,
  CanvasCommentThreadsACL,
  CanvasesACL,
  CanvasFoldersACL,
  CanvasUserStatusACL,
  CanvasVersionsACL,
  ChannelBoardMappingsACL,
  ChannelDailyRecapsACL,
  ChannelPublishedTabsACL,
  ChannelRecapsACL,
  ChannelsACL,
  ChannelStatsACL,
  ChannelUserStatusACL,
  ClassificationMappingsACL,
  CoesACL,
  CollectionItemsACL,
  CollectionPermissionsACL,
  CollectionsACL,
  ConversationLabelMappingsACL,
  ConversationLabelsACL,
  ConversationParticipantsACL,
  ConversationsACL,
  CustomEmojisACL,
  DashboardQueriesMappingACL,
  DashboardsACL,
  EmailChannelPreferencesACL,
  EmailsACL,
  ExternalStepResponsesACL,
  FormContextMappingsACL,
  FormEntityValuesACL,
  FormFieldsACL,
  FormsACL,
  GlobalFieldsACL,
  ImpactsACL,
  InstalledAppsACL,
  InvitationsACL,
  LinkAccessACL,
  LinksACL,
  MessageAttachmentsACL,
  OrganizationsACL,
  ProactiveNudgesACL,
  ProjectsACL,
  ProjectTagsACL,
  PullRequestsACL,
  QueriesACL,
  RcasACL,
  RecapsACL,
  RecurringCallParticipantsACL,
  RecurringCallSeriesACL,
  ReleaseAttributionsACL,
  ReleaseChangesACL,
  ReleaseChangeTypesACL,
  ReleaseEventsACL,
  ReposACL,
  RolesACL,
  SavedUserConfigurationsACL,
  SavedUserConfigurationValuesACL,
  StagePRStatusMappingsACL,
  StagesACL,
  StageTransitionsACL,
  SubTicketsACL,
  SurfaceLinksACL,
  SurfaceNudgeCountsACL,
  SurfaceNudgesACL,
  TicketActivitiesACL,
  TicketAssignmentsACL,
  TicketDescriptionsACL,
  TicketEntityMappingsACL,
  TicketReferenceMappingsACL,
  TicketsACL,
  TicketStageEtaACL,
  TicketSubTicketMappingsACL,
  TicketTagMappingsACL,
  TicketTagsACL,
  ToolsACL,
  UserAssignmentStatesACL,
  UserExpertiseMappingsACL,
  UserGroupMappingsACL,
  UserGroupsACL,
  UserProfilesACL,
  UserRoleMappingsACL,
  UserWorkloadMappingsACL,
  ViewAccessACL,
  WorkflowExecutionsACL,
  WorkflowsACL,
  WorkflowStepsACL,
  WorkspacesACL,
} from '../tables'
import { UserActivityEventsAcl } from '../tables/user_activity_acl'
import {
  AgentProactivityDecisionsACL,
  AgentProactivityXorCallsACL,
  AgentProactivityXorQuestionsACL,
} from '../tables/agent-proactivity-decisions-acl'
import { admin, custom, entity, member, org, platform, secret, self, system, type PolicyFactory } from './constructors'
import { parent } from './parents'
import {
  AppsPolicyACL,
  CanvasParticipantPolicyACL,
  ChannelParticipantPolicyACL,
  MessagePolicyACL,
  OrgMemberPolicyACL,
  ReactionPolicyACL,
  TicketStageRequestPolicyACL,
  UserPolicyACL,
} from './table-rules'

/**
 * The policy map: the access rule of every table. One entry per Prisma model.
 *
 * Typed Record<Prisma.ModelName, …>: adding a model to schema.prisma fails the build until it has
 * an entry here, so no table can silently fall back to a default.
 *
 * Every entry runs inside PolicyACL, which applies to every table:
 *   - GUEST denied unless the entry says `guest: 'read' | 'write'`
 *   - no insert into another workspace, no move of a row to another workspace
 *   - `hidden` columns stripped from what a user request gets back
 *
 * Generic classes: self, secret, admin, org, member, entity, system, platform (see classes.ts).
 * `custom(Existing)` keeps a table's hand-written rule (Slack Connect reach, DM exclusion, guest
 * channel grants) while still running inside PolicyACL. Table-specific additions live in
 * table-rules.ts.
 *
 * Only user requests are governed by these rules. Backend code (jobs, webhooks, and side effects
 * inside a request wrapped in withWorkspaceScope) keeps workspace scope alone.
 */

// Parents reached by a key column only (no Prisma relation field on the child).
const channelByKey = parent({ model: 'channel', fk: 'channelId' })
const callByKey = parent({ model: 'call', fk: 'callId' })
const messageParent = parent({ model: 'message', path: 'message', fk: 'messageId', pk: 'messageId' })
const conversationByKey = parent({ model: 'conversation', fk: 'conversationId', pk: 'conversationId' })
const callParent = parent({ model: 'call', path: 'call', fk: 'callId' })
const executionParent = parent({ model: 'workflowExecution', path: 'workflowExecution', fk: 'workflowExecutionId' })
const executionByKey = parent({ model: 'workflowExecution', fk: 'workflowExecutionId' })
const dataSourceParent = parent({ model: 'dataSource', path: 'dataSource', fk: 'dataSourceId' })
const dataSourceTableParent = parent({ model: 'dataSourceTable', path: 'table', fk: 'tableId' })
const dynamicDashboardParent = parent({ model: 'dynamicDashboard', path: 'dashboard', fk: 'dashboardId' })
const appParent = parent({ model: 'apps', path: 'app', fk: 'appId' })
const installedAppParent = parent({ model: 'installedApps', path: 'installedApp', fk: 'installedAppId' })
const authSessionParent = parent({ model: 'authSession', path: 'authSession', fk: 'authSessionId' })
const entityParent = parent({ model: 'entity', path: 'entity', fk: 'entityId' })
const auditLogParent = parent({ model: 'auditLog', path: 'auditLog', fk: 'auditLogId' })
const ingestionBatchParent = parent({ model: 'teamIntelligenceIngestionBatchV2', path: 'batch', fk: 'batchId', childHasWorkspace: false })
const doclingFileParent = parent({ model: 'doclingAsyncFile', path: 'file', fk: 'fileId' })

const SESSION_TOKENS = ['refreshToken', 'fcmToken', 'voipToken']

export const POLICY: Record<Prisma.ModelName, PolicyFactory> = {
  // ── Self: one user's own rows ────────────────────────────────────────────────
  ApiKey: self('userId', { hidden: ['keyHash'], adminRevoke: true }),
  AuthSession: self('orgMemberId', { ownerIs: 'memberId', workspaceScoped: false, hidden: SESSION_TOKENS, guest: 'write' }),
  AuthSessionWorkspaceAccess: entity(authSessionParent, { guest: 'write' }),
  Bookmark: self('userId', { guest: 'write' }),
  BrowserNotificationSubscription: self('userId', { guest: 'write' }),
  CanvasUserStatus: custom(CanvasUserStatusACL, { guest: 'write' }),
  ChannelSection: self('userId', { guest: 'write' }),
  ChannelUserStatus: custom(ChannelUserStatusACL, { guest: 'write' }),
  DelayedMessage: self('senderId', { guest: 'write' }),
  DraftMessage: self('userId', { guest: 'write' }),
  EmailDraft: self('userId', { guest: 'write' }),
  EmailRead: self('userId', { guest: 'write' }),
  EmailSignature: self('userId', { guest: 'write' }),
  Notification: self('userId', { guest: 'write' }),
  NotificationPreference: self('userId', { guest: 'write' }),
  OrgMemberCredential: self('memberId', { ownerIs: 'memberId', workspaceScoped: false, hidden: ['passwordHash'] }),
  QuestionnaireResponse: self('userId', { guest: 'write' }),
  RadarRule: self('userId'),
  Recap: custom(RecapsACL),
  SavedUserConfiguration: custom(SavedUserConfigurationsACL, { guest: 'write' }),
  SavedUserConfigurationValue: custom(SavedUserConfigurationValuesACL, { guest: 'write' }),
  ScheduledMessage: self('createdBy', { guest: 'write' }),
  SessionRecordingFile: self('userId'),
  SurfaceNudgeCount: custom(SurfaceNudgeCountsACL, { guest: 'write' }),
  TicketUserMailbox: self('userId', { guest: 'write' }),
  User: (c, p) => new UserPolicyACL(c, p, { guest: 'read' }),
  UserExternalToken: self('userId', { hidden: ['encryptedToken', 'refreshToken'], adminRevoke: true }),
  UserPreference: self('userId', { guest: 'write' }),
  UserPresence: self('userId', { read: 'members', guest: 'write' }),
  UserProfile: custom(UserProfilesACL, { guest: 'write' }),
  UserSession: self('userId', { hidden: ['accessToken', ...SESSION_TOKENS], adminRevoke: true }),
  UserSkill: self('userId', { read: 'members' }),
  ViewAccess: custom(ViewAccessACL, { guest: 'write' }),

  // ── Secret: shared workspace credentials ─────────────────────────────────────
  Model: secret({ hidden: ['credentials'] }),
  DataSource: secret({ owner: 'createdBy', read: 'members', hidden: ['credentials'] }),
  WorkflowCredential: secret({ hidden: ['credentials'] }),
  // ExternalSource: 63 request-path writers across the desk integrations; members keep write access
  // (guests lose it) until those flows are reviewed, then it moves to secret({ hidden: ['credentials'] }).
  ExternalSource: member(),
  AppIncomingWebhook: secret({ owner: 'createdBy', read: 'members' }),
  Repo: custom(ReposACL),

  // ── Admin: settings, permissions, structure ──────────────────────────────────
  ResourceAccess: admin({ resource: 'ROLES' }),
  Role: custom(RolesACL),
  UserRoleMapping: custom(UserRoleMappingsACL),
  UserGroup: custom(UserGroupsACL),
  UserGroupMapping: custom(UserGroupMappingsACL),
  GuestAccess: admin(),
  EntityAccess: system({ read: 'members' }),
  Workspace: custom(WorkspacesACL, { guest: 'read' }),
  WorkspaceJoinRequest: admin({ read: 'admins' }),
  Invitation: custom(InvitationsACL, { guest: 'read' }),
  Project: custom(ProjectsACL, { guest: 'read' }),
  ProjectTag: custom(ProjectTagsACL),
  Board: custom(BoardsACL, { guest: 'read' }),
  BoardSlaPolicy: custom(BoardSlaPoliciesACL),
  BoardComplexityScore: custom(BoardComplexityScoresACL),
  Stage: custom(StagesACL, { guest: 'read' }),
  StageTransition: custom(StageTransitionsACL),
  StagePRStatusMapping: custom(StagePRStatusMappingsACL),
  StageApprovers: admin({ resource: 'LISTPROJECTS' }),
  UserAssignmentState: custom(UserAssignmentStatesACL),
  UserWorkloadMapping: custom(UserWorkloadMappingsACL),
  UserExpertiseMapping: custom(UserExpertiseMappingsACL),
  Form: custom(FormsACL, { guest: 'read' }),
  FormFields: custom(FormFieldsACL, { guest: 'read' }),
  FormContextMapping: custom(FormContextMappingsACL, { guest: 'read' }),
  GlobalField: custom(GlobalFieldsACL),
  ClassificationMapping: custom(ClassificationMappingsACL),
  DeskAutoLabelRuleReference: admin(),
  TagsConfig: admin(),
  ThreadTypeVocabulary: member(),
  ChannelBoardMapping: custom(ChannelBoardMappingsACL, { guest: 'read' }),
  ChannelPublishedTab: custom(ChannelPublishedTabsACL, { guest: 'read' }),
  EmailChannelPreference: custom(EmailChannelPreferencesACL),
  InstalledApps: custom(InstalledAppsACL, { guest: 'read' }),
  InstalledAppPermission: entity(installedAppParent, { guest: 'read' }),
  InstalledAppCommand: entity(installedAppParent, { guest: 'read' }),
  AppCommand: entity(appParent),
  AppPermission: entity(appParent),
  DataSourceTable: entity(dataSourceParent),
  DataSourceColumn: entity(dataSourceTableParent),
  DataSourceRelationship: entity(dataSourceParent),
  ReleaseChangeType: custom(ReleaseChangeTypesACL),
  ReleaseRepository: member(),

  // ── Org: organisation-level rows ─────────────────────────────────────────────
  Organization: custom(OrganizationsACL, { guest: 'read' }),
  OrganizationDomain: org(),
  OrgMember: (c, p) => new OrgMemberPolicyACL(c, p, { hidden: ['passwordHash'] }),
  OrgLLMServiceAccountCredential: org({ read: 'admins', hidden: ['credentials'] }),
  WorkspaceOrganization: org(),
  Apps: (c, p) => new AppsPolicyACL(c, p, { guest: 'read' }),
  TeamIntelligenceIngestionBatchV2: org({ read: 'admins' }),
  TeamIntelligenceUserIngestionV2: entity(ingestionBatchParent),
  TeamIntelligenceTeamSummaryV2: entity(ingestionBatchParent),
  TeamIntelligenceOrgSummaryV2: entity(ingestionBatchParent),

  // ── Member: shared workspace content, no guests ──────────────────────────────
  Agent: custom(AgentsACL),
  AgentStep: custom(AgentStepsACL),
  AgentToolsMapping: custom(AgentToolsMappingsACL),
  Tool: custom(ToolsACL),
  Application: custom(ApplicationsACL),
  ApplicationReleaseTicket: custom(ApplicationReleaseTicketsACL),
  ReleaseAttribution: custom(ReleaseAttributionsACL),
  ReleaseChange: custom(ReleaseChangesACL),
  ReleaseEvent: custom(ReleaseEventsACL),
  COE: custom(CoesACL),
  RCA: custom(RcasACL),
  Impact: custom(ImpactsACL),
  Query: custom(QueriesACL),
  Dashboard: custom(DashboardsACL),
  dashboardQueryMapping: custom(DashboardQueriesMappingACL),
  DynamicDashboard: member({ creator: 'createdBy' }),
  DynamicDashboardQuery: member({ creator: 'createdBy' }),
  DynamicDashboardQueryMapping: entity(dynamicDashboardParent),
  DashboardParticipant: entity(dynamicDashboardParent),
  CanvasFolder: custom(CanvasFoldersACL),
  SummaryTemplate: member({ creator: 'createdBy' }),
  SurfaceLink: custom(SurfaceLinksACL),
  Tag: member(),
  WorkflowFolder: member(),
  WorkflowKnowledge: member(),
  KnowledgeDocument: member(),
  TicketExport: member(),
  SdlcArtifact: member(), // archived by other members and by the Claw bot, not only its creator
  SdlcEntityLink: member(),
  SdlcFolder: member({ creator: 'createdBy' }),
  SdlcItemComment: member({ creator: 'createdBy' }),
  SdlcTrack: member({ creator: 'createdBy' }),
  Workflow: custom(WorkflowsACL, { guest: 'read' }),
  CustomEmoji: custom(CustomEmojisACL, { guest: 'read' }),
  ConversationLabel: custom(ConversationLabelsACL),
  ConversationLabelMapping: custom(ConversationLabelMappingsACL),

  // ── Entity: rows that belong to a channel, ticket, canvas or call ────────────
  Channel: custom(ChannelsACL, { guest: 'write' }),
  ChannelParticipant: (c, p) => new ChannelParticipantPolicyACL(c, p, { guest: 'write' }),
  Conversation: custom(ConversationsACL, { guest: 'write' }),
  ConversationParticipant: custom(ConversationParticipantsACL, { guest: 'write' }),
  Message: (c, p) => new MessagePolicyACL(c, p, { guest: 'write' }),
  MessageAttachment: custom(MessageAttachmentsACL, { guest: 'write' }),
  MessageArtifact: entity(conversationByKey, { writeVia: 'read', guest: 'read' }),
  Reaction: (c, p) => new ReactionPolicyACL(c, p, { guest: 'write' }),
  Email: custom(EmailsACL, { guest: 'write' }),
  Link: custom(LinksACL, { guest: 'write' }),
  LinkAccess: custom(LinkAccessACL, { guest: 'write' }),
  AgentConversationShare: entity(parent({ model: 'conversation', fk: 'targetConversationId', pk: 'conversationId' }), { writeVia: 'read' }),
  Activity: custom(ActivitiesACL, { guest: 'write' }),
  Ticket: custom(TicketsACL, { guest: 'write' }),
  TicketDescription: custom(TicketDescriptionsACL, { guest: 'write' }),
  TicketAssignment: custom(TicketAssignmentsACL, { guest: 'write' }),
  TicketEntityMapping: custom(TicketEntityMappingsACL, { guest: 'write' }),
  TicketReferenceMapping: custom(TicketReferenceMappingsACL, { guest: 'write' }),
  TicketStageEta: custom(TicketStageEtaACL, { guest: 'read' }),
  TicketSubTicketMapping: custom(TicketSubTicketMappingsACL, { guest: 'write' }),
  TicketTag: custom(TicketTagsACL, { guest: 'write' }),
  TicketTagMapping: custom(TicketTagMappingsACL),
  TicketStageRequest: (c, p) => new TicketStageRequestPolicyACL(c, p),
  SubTicket: custom(SubTicketsACL, { guest: 'write' }),
  FormEntityValues: custom(FormEntityValuesACL),
  ExternalStepResponse: custom(ExternalStepResponsesACL, { guest: 'write' }),
  Canvas: custom(CanvasesACL, { guest: 'write' }),
  CanvasParticipant: (c, p) => new CanvasParticipantPolicyACL(c, p, { guest: 'write' }),
  CanvasVersion: custom(CanvasVersionsACL, { guest: 'write' }),
  CanvasCommentThread: custom(CanvasCommentThreadsACL, { guest: 'write' }),
  CanvasComment: custom(CanvasCommentsACL, { guest: 'write' }),
  Call: custom(CallsACL, { guest: 'write' }),
  CallParticipant: custom(CallParticipantsACL, { guest: 'write' }),
  CallMessage: entity(callByKey, { writeVia: 'read', guest: 'write' }),
  CallRecording: entity(callParent, { writeVia: 'read', guest: 'read' }),
  RecurringCallSeries: custom(RecurringCallSeriesACL),
  RecurringCallParticipant: custom(RecurringCallParticipantsACL),
  Collection: custom(CollectionsACL),
  CollectionItem: custom(CollectionItemsACL),
  CollectionPermission: custom(CollectionPermissionsACL),

  // ── System: written by backend code only ─────────────────────────────────────
  ACLAuditLog: system({ read: 'admins' }),
  AuditLog: system({ read: 'admins' }),
  AuditLogChange: entity(auditLogParent),
  UserActivityEvent: custom(UserActivityEventsAcl),
  TicketActivity: custom(TicketActivitiesACL, { guest: 'read' }),
  ChannelStats: custom(ChannelStatsACL, { guest: 'read' }),
  ChannelRecap: custom(ChannelRecapsACL),
  ChannelDailyRecap: custom(ChannelDailyRecapsACL),
  ReactionCount: system({ read: messageParent, guest: 'read' }),
  ProactiveNudge: custom(ProactiveNudgesACL),
  SurfaceNudge: custom(SurfaceNudgesACL),
  // Agent proactivity pipeline records: readable and writable by members of their channel.
  AgentProactivityDecision: custom(AgentProactivityDecisionsACL),
  AgentProactivityXorCall: custom(AgentProactivityXorCallsACL),
  AgentProactivityXorQuestion: custom(AgentProactivityXorQuestionsACL),
  ExternalMessage: system({ read: parent({ model: 'message', path: 'entity', fk: 'entityId', pk: 'messageId' }) }),
  // Created with the PR message it links, in the same batch: anyone who can see the conversation.
  PrThreadLink: entity(conversationByKey, { writeVia: 'read' }),
  RadarPrLink: system({ read: channelByKey }),
  PullRequests: custom(PullRequestsACL, { guest: 'read' }),
  WorkflowExecution: custom(WorkflowExecutionsACL, { guest: 'read' }),
  WorkflowExecutionState: entity(executionParent),
  WorkflowExecutionLock: system({ read: 'none' }),
  WorkflowExecutionUsers: system({ read: executionByKey }),
  WorkflowStep: custom(WorkflowStepsACL),
  ExecutionItem: entity(channelByKey, { writeVia: 'read' }),
  ExecutionItemMutation: system({ read: 'members' }),
  ExecutionRunLog: system({ read: 'members' }),
  ExecutionThreadState: system({ read: 'members' }),
  // Append-only log of dashboard actions: a user request may only record its own actions.
  DashboardActivity: system({ read: 'members', allowCreate: (ctx, d) => d.actorUserId === ctx.userId }),
  Entity: system({ read: 'members' }),
  EntityAlias: system({ read: entityParent }),
  // Created with its canvas/channel. A user request may only open a group hosted by its own
  // workspace with nobody invited yet; inviting and accepting are backend flows.
  ConnectGroup: system({
    read: 'none',
    allowCreate: (ctx, d) => d.hostWorkspaceId === ctx.workspaceId && (d.invitedWorkspaceId ?? null) === null,
  }),
  DoclingAsyncFile: system({ read: 'none' }),
  DoclingAsyncPart: entity(doclingFileParent),
  VespaInsertionLogs: system({ read: 'none' }),
  AiProvisioningStatus: system({ read: 'none' }),

  // ── Platform: global reference data ──────────────────────────────────────────
  ActivityAlias: platform(),
  AvailableAppPermission: platform(),
  LookupValue: platform(),
  Merchant: platform(),
  Resource: platform(),
  WorkflowMapping: platform({ hidden: ['entitySecret'], guest: 'none' }),
}

