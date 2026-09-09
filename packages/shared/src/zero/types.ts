// Define enums

// @ts-ignore TS1294
export enum TicketCategory {
  USER_ONBOARDING = 'USER_ONBOARDING',
  QUERY_WORKFLOW = 'QUERY_WORKFLOW',
  QUERY = 'QUERY',
  ISSUE = 'ISSUE',
  REQUIREMENT_NEW = 'REQUIREMENT_NEW',
  REQUIREMENT_ENHANCEMENT = 'REQUIREMENT_ENHANCEMENT',
  FULL_PG_INTEGRATION = 'FULL_PG_INTEGRATION',
  STAGE_APPROVAL_WORKFLOW = 'STAGE_APPROVAL_WORKFLOW',
}

// @ts-ignore TS1294
export enum TicketStatus {
  NEW = 'NEW',
  IN_PROGRESS = 'IN_PROGRESS',
  WAIT_FOR_APPROVAL = 'WAIT_FOR_APPROVAL',
  REJECTED = 'REJECTED',
  RESOLVED = 'RESOLVED',
}

// @ts-ignore TS1294
export enum TicketStatusV2 {
  TODO = 'TODO',
  STARTED = 'STARTED',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

// Gmail-style per-user mailbox location for a ticket (see ticketUserMailboxTable).
// ARCHIVED = removed from Inbox but still in All Mail. Absence of a row = INBOX.
// @ts-ignore TS1294
export enum MailboxState {
  INBOX = 'INBOX',
  ARCHIVED = 'ARCHIVED',
  SPAM = 'SPAM',
}

// @ts-ignore TS1294
export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

// @ts-ignore TS1294
export enum AutoDraftMode {
  OFF = 'OFF',
  DRAFT = 'DRAFT',
}

// @ts-ignore TS1294
export enum AutoDraftStatus {
  GENERATING = 'GENERATING',
  READY = 'READY',
}

// @ts-ignore TS1294
export enum TicketReferenceRelation {
  LINKED = 'LINKED',
  DUPLICATE_CONFIRMED = 'DUPLICATE_CONFIRMED',
  DUPLICATE_POSSIBLE = 'DUPLICATE_POSSIBLE',
  MERGED_INTO = 'MERGED_INTO',
}

// @ts-ignore TS1294
export enum EmailMergeMode {
  DISABLED = 'DISABLED',
  ENABLED = 'ENABLED',
}

// @ts-ignore TS1294
export enum UserResponsibility {
  MANAGER = 'MANAGER',
  TEAM_LEAD = 'TEAM_LEAD',
  MEMBER = 'MEMBER',
  PR_REVIEWER = 'PR_REVIEWER',
  QA = 'QA',
}

// @ts-ignore TS1294
export enum RotationInterval {
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
}

// @ts-ignore TS1294
export enum EntityType {
  MERCHANT = 'MERCHANT',
  GATEWAY = 'GATEWAY',
}

export enum GuestEntity {
  CHANNEL = 'CHANNEL',
  CANVAS = 'CANVAS',
}

// @ts-ignore TS1294
export enum RecapEntityType {
  CHANNEL = 'CHANNEL',
  PROJECT = 'PROJECT',
}

// @ts-ignore TS1294
export enum AttachmentEntityType {
  TICKET = 'TICKET',
  CHAT = 'CHAT',
  CANVAS = 'CANVAS',
  DRAFT = 'DRAFT',
  DELAYED_MESSAGE = 'DELAYED_MESSAGE',
  EMAIL = 'EMAIL',
  IMPACT = 'IMPACT',
  COLLECTION = 'COLLECTION',
  FORM_ENTITY_VALUE = 'FORM_ENTITY_VALUE',
  WORKFLOW_STEPS = 'WORKFLOW_STEPS',
  DESK_REPORT = 'DESK_REPORT',
}

// @ts-ignore TS1294
export enum TicketEnvironment {
  DEVELOPMENT = 'DEVELOPMENT',
  STAGING = 'STAGING',
  PRODUCTION = 'PRODUCTION',
}

// @ts-ignore TS1294
export enum ReportedBy {
  MERCHANT = 'MERCHANT',
  INTERNAL = 'INTERNAL',
}

// @ts-ignore TS1294
export enum ChannelScopeType {
  DEFAULT = 'DEFAULT',
  DM = 'DM',
  TICKET = 'TICKET',
  DOCUMENT = 'DOCUMENT',
  GROUP_DM = 'GROUP_DM',
}

// @ts-ignore TS1294
export enum ChannelRole {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

// @ts-ignore TS1294
export enum ChannelVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

// @ts-ignore TS1294
export enum CalendarVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

// @ts-ignore TS1294
export enum ChannelAddUserPolicy {
  EVERYONE = 'EVERYONE',
  ADMINS_ONLY = 'ADMINS_ONLY',
}

// @ts-ignore TS1294
export enum ChannelSortOrder {
  UNREAD = 'UNREAD',
  RECENCY = 'RECENCY',
  ALPHABETICAL = 'ALPHABETICAL',
}

// @ts-ignore TS1294
export enum ChannelFilterMode {
  ACTIVE = 'ACTIVE',
  UNREADS = 'UNREADS',
  MENTIONS = 'MENTIONS',
  ALL = 'ALL',
}

// @ts-ignore TS1294
export enum MessageType {
  USER = 'USER',
  BOT = 'BOT',
  SYSTEM = 'SYSTEM',
  FORWARDED = 'FORWARDED',
}

// @ts-ignore TS1294
export enum OrgRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  VIEWER = 'VIEWER',
  COMMUNITY_MEMBER = 'COMMUNITY_MEMBER',
  GUEST = 'GUEST',
}

// @ts-ignore TS1294
export enum Membertype {
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
}

// @ts-ignore TS1294
export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  MEMBER = 'MEMBER',
  GUEST = 'GUEST',
  COMMUNITY_MEMBER = 'COMMUNITY_MEMBER',
}

export const WorkspaceType = {
  ENTERPRISE: 'ENTERPRISE',
  COMMUNITY: 'COMMUNITY',
} as const;

export type WorkspaceType = typeof WorkspaceType[keyof typeof WorkspaceType];

export const WorkspaceJoinPolicy = {
  INVITE_ONLY: 'INVITE_ONLY',
  OPEN: 'OPEN',
  REQUEST_TO_JOIN: 'REQUEST_TO_JOIN',
} as const;

export type WorkspaceJoinPolicy = typeof WorkspaceJoinPolicy[keyof typeof WorkspaceJoinPolicy];

export const CommunityJoinResultStatus = {
  JOINED: 'JOINED',
  REQUEST_PENDING: 'REQUEST_PENDING',
  REQUEST_REJECTED: 'REQUEST_REJECTED',
} as const;

export type CommunityJoinResultStatus =
  typeof CommunityJoinResultStatus[keyof typeof CommunityJoinResultStatus];

export const WorkspaceJoinRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export type WorkspaceJoinRequestStatus =
  typeof WorkspaceJoinRequestStatus[keyof typeof WorkspaceJoinRequestStatus];

export const WorkspaceJoinRequestAction = {
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
} as const;

export type WorkspaceJoinRequestAction =
  typeof WorkspaceJoinRequestAction[keyof typeof WorkspaceJoinRequestAction];

export const AIProvisioningSubjectType = {
  ORG: 'ORG',
  WORKSPACE: 'WORKSPACE',
  USER: 'USER',
} as const;

export type AIProvisioningSubjectType =
  typeof AIProvisioningSubjectType[keyof typeof AIProvisioningSubjectType];

export const AIProvisioningProvider = {
  CLAW_LITELLM: 'CLAW_LITELLM',
} as const;

export type AIProvisioningProvider =
  typeof AIProvisioningProvider[keyof typeof AIProvisioningProvider];

export const AIProvisioningStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export type AIProvisioningStatus =
  typeof AIProvisioningStatus[keyof typeof AIProvisioningStatus];

export const OrgLLMServiceAccountProvider = {
  LITELLM: 'LITELLM',
} as const;

export type OrgLLMServiceAccountProvider =
  typeof OrgLLMServiceAccountProvider[keyof typeof OrgLLMServiceAccountProvider];

export const OrgLLMServiceAccountPurpose = {
  ASK_AI: 'ASK_AI',
  CALL_TRANSCRIPT: 'CALL_TRANSCRIPT',
  ACTIVITY_CLASSIFICATION: 'ACTIVITY_CLASSIFICATION',
  TICKET_DUPLICATE: 'TICKET_DUPLICATE',
  TICKET_BOARD: 'TICKET_BOARD',
  EMAIL_REWRITE: 'EMAIL_REWRITE',
  SUMMARISER: 'SUMMARISER',
  WORKFLOW: 'WORKFLOW',
  DEFAULT: 'DEFAULT',
  CLAW_ORG_KEY: 'CLAW_ORG_KEY',
} as const;

export type OrgLLMServiceAccountPurpose =
  typeof OrgLLMServiceAccountPurpose[keyof typeof OrgLLMServiceAccountPurpose];

export const OrgLLMServiceAccountCredentialStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  FAILED: 'FAILED',
  REVOKED: 'REVOKED',
} as const;

export type OrgLLMServiceAccountCredentialStatus =
  typeof OrgLLMServiceAccountCredentialStatus[keyof typeof OrgLLMServiceAccountCredentialStatus];

export const OrganizationDomainVerificationStatus = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  REJECTED: 'REJECTED',
} as const;

export type OrganizationDomainVerificationStatus =
  typeof OrganizationDomainVerificationStatus[keyof typeof OrganizationDomainVerificationStatus];

// @ts-ignore TS1294
export enum Status {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  DELETED = 'DELETED',
}

// @ts-ignore TS1294
export enum ActivityType {
  TITLE = 'TITLE',
  DESCRIPTION = 'DESCRIPTION',
  STATUS = 'STATUS',
  ASSIGNED_TO = 'ASSIGNED_TO',
  TICKET_TYPE = 'TICKET_TYPE',
  PRIORITY = 'PRIORITY',
  ETA = 'ETA',
  STAGE_ETA = 'STAGE_ETA',
  METADATA = 'METADATA',
  CLOSED_AT = 'CLOSED_AT',
  CLOSED_BY = 'CLOSED_BY',
  REFERENCE_TICKET = 'REFERENCE_TICKET',
  STAGE_NAME = 'STAGE_NAME',
  TAGS = 'TAGS',
  ENTITY = 'ENTITY',
  SUBTICKET_CREATED = 'SUBTICKET_CREATED',
  SUBTICKET_LINKED = 'SUBTICKET_LINKED',
  SUBTICKET_UNLINKED = 'SUBTICKET_UNLINKED',
  BOARD = 'BOARD',
  PR = 'PR',
  USER_GROUP_ID = 'USER_GROUP_ID',
  PR_REVIEWER = 'PR_REVIEWER',
  QA = 'QA',
  STAGE_CHANGE_REQUEST = 'STAGE_CHANGE_REQUEST',
  STAGE_CHANGE_APPROVED = 'STAGE_CHANGE_APPROVED',
  STAGE_CHANGE_REJECTED = 'STAGE_CHANGE_REJECTED',
  IS_ARCHIVED = 'IS_ARCHIVED',
  MERGED = 'MERGED',
  UNMERGED = 'UNMERGED',
  RCA_CREATED = 'RCA_CREATED',
  RCA_UPDATED = 'RCA_UPDATED',
  EMAIL_SENT = 'EMAIL_SENT',
  TICKET_CREATED = 'TICKET_CREATED',
  CSAT_RECEIVED = 'CSAT_RECEIVED',
}

// @ts-ignore TS1294
export enum ActivityClassification {
  ACTIONABLE = 'ACTIONABLE',
  FYI = 'FYI',
  SKIP = 'SKIP',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  ERROR = 'ERROR',
}

// @ts-ignore TS1294
export enum ActivityClassificationJobType {
  SINGLE = 'SINGLE',
  SPECIAL_MENTION_AUDIENCE = 'SPECIAL_MENTION_AUDIENCE',
}

// Lifecycle of a structured message whose state drives UI outside the message
// bubble. Stored as a string in Postgres so adding a future lifecycle state
// does not require altering a database enum.
// @ts-ignore TS1294
export enum MessageArtifactStatus {
  ACTIVE = 'active',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
}

// @ts-ignore TS1294
export enum CallType {
  AUDIO = 'AUDIO',
  VIDEO = 'VIDEO',
  HEADLESS = 'HEADLESS'
}

// @ts-ignore TS1294
export enum CallOrigin {
  CHANNEL = 'CHANNEL',
  CONVERSATION = 'CONVERSATION',
  GOOGLE_CALENDAR = 'GOOGLE_CALENDAR',
  MICROSOFT_CALENDAR = 'MICROSOFT_CALENDAR',
}

// @ts-ignore TS1294
export enum CallStatus {
  SCHEDULED = 'SCHEDULED',
  ACTIVE = 'ACTIVE',
  IN_PROGRESS = 'IN_PROGRESS',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

// @ts-ignore TS1294
export enum CallVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

// @ts-ignore TS1294
export enum RecordingType {
  AUDIO_ONLY = 'AUDIO_ONLY',
  AUDIO_SCREEN = 'AUDIO_SCREEN',
  AUDIO_VIDEO = 'AUDIO_VIDEO',
}

// @ts-ignore TS1294
export enum RecurringCallSeriesStatus {
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

// @ts-ignore TS1294
export enum InvitationResponse {
  INVITED = 'INVITED',
  REQUESTED = 'REQUESTED',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  LEFT = 'LEFT',
  MISSED = 'MISSED',
}

// @ts-ignore TS1294
export enum MeetingStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  MAYBE = 'MAYBE',
  HIDDEN = 'HIDDEN',
}

// @ts-ignore TS1294
export enum ConversationParticipation {
  AUTHOR = 'AUTHOR',
  MENTIONED = 'MENTIONED',
}

// @ts-ignore TS1294
export enum AuthProvider {
  GOOGLE = 'GOOGLE',
  MICROSOFT = "MICROSOFT",
  API_KEY = 'API_KEY',
  EMAIL = 'EMAIL',
}

// @ts-ignore TS1294
export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// @ts-ignore TS1294
export enum UserType {
  USER = 'USER',
  BOT = 'BOT',
  APP = 'APP',
}

// @ts-ignore TS1294
export enum AppIncomingWebhookType {
  SLACK = 'SLACK',
  SENTINELONE = 'SENTINELONE',
  AMAZON_SNS = 'AMAZON_SNS',
  PINGDOM = 'PINGDOM',
  GCP = 'GCP',
}

// @ts-ignore TS1294
export enum AppIncomingWebhookAction {
  MESSAGE = 'MESSAGE',
  TICKET = 'TICKET',
}

// @ts-ignore TS1294
export enum CommandType {
  COMMAND = 'COMMAND',
  SHORTCUT = 'SHORTCUT',
}

// @ts-ignore TS1294
export enum CommandAccessibility {
  CHAT = 'CHAT',
  THREAD = 'THREAD',
  BOTH = 'BOTH',
  MESSAGE = 'MESSAGE',
  GLOBAL = 'GLOBAL',
}

// @ts-ignore TS1294
export enum UserPresenceStatus {
  ONLINE = 'ONLINE',
  AWAY = 'AWAY',
  OFFLINE = 'OFFLINE',
}

// @ts-ignore TS1294
export enum AccessType {
  ADMIN = 'ADMIN',
  READ = 'READ',
  WRITE = 'WRITE',
}

// @ts-ignore TS1294
export enum SessionStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

// @ts-ignore TS1294
export enum ACLAuditEventType {
  RESOURCE_CREATED = 'RESOURCE_CREATED',
  RESOURCE_UPDATED = 'RESOURCE_UPDATED',
  RESOURCE_DELETED = 'RESOURCE_DELETED',
  PERMISSION_GRANTED = 'PERMISSION_GRANTED',
  PERMISSION_REVOKED = 'PERMISSION_REVOKED',
  PERMISSION_UPDATED = 'PERMISSION_UPDATED',
  USER_GROUP_CREATED = 'USER_GROUP_CREATED',
  USER_GROUP_UPDATED = 'USER_GROUP_UPDATED',
  USER_GROUP_DELETED = 'USER_GROUP_DELETED',
  USER_GROUP_DEACTIVATED = 'USER_GROUP_DEACTIVATED',
  USER_GROUP_REACTIVATED = 'USER_GROUP_REACTIVATED',
}

// @ts-ignore TS1294
export enum ACLAuditTargetType {
  RESOURCE = 'RESOURCE',
  RESOURCE_ACCESS = 'RESOURCE_ACCESS',
  USER_GROUP = 'USER_GROUP',
}

// @ts-ignore TS1294
export enum QueryVisualizationType {
  KPI = 'KPI',
  BAR_CHART = 'BAR_CHART',
  PIE_CHART = 'PIE_CHART',
  DONUT_CHART = 'DONUT_CHART',
  LINE_CHART = 'LINE_CHART',
  FUNNEL = 'FUNNEL',
  HEATMAP = 'HEATMAP',
  DATA_TABLE = 'DATA_TABLE',
  AREA_CHART = 'AREA_CHART',
  KPI_COMPARE = 'KPI_COMPARE',
  SCATTER_CHART = 'SCATTER_CHART',
}

// @ts-ignore TS1294
export enum PRStatus {
  OPEN = 'OPEN',
  DECLINED = 'DECLINED',
  MERGED = 'MERGED',
  DELETED = 'DELETED',
  UPDATED = 'UPDATED',
}

// @ts-ignore TS1294
export enum PRStatusEvent {
  CREATED = 'CREATED',
  UPDATED = 'UPDATED',
  MERGED = 'MERGED',
  DECLINED = 'DECLINED',
  DELETED = 'DELETED',
}

// @ts-ignore TS1294
export enum MessageDirection {
  INCOMING = 'INCOMING',
  OUTGOING = 'OUTGOING',
}

// @ts-ignore TS1294
export enum NotificationType {
  TICKET_STATUS_CHANGE = "TICKET_STATUS_CHANGE",
  TICKET_ASSIGNMENT = "TICKET_ASSIGNMENT",
  TICKET_REASSIGNMENT = "TICKET_REASSIGNMENT",
  TICKET_DUE_DATE_CHANGED = "TICKET_DUE_DATE_CHANGED",
  TICKET_PRIORITY_CHANGED = "TICKET_PRIORITY_CHANGED",
  TICKET_USER_GROUP_CHANGED = "TICKET_USER_GROUP_CHANGED",
  TICKET_TITLE_CHANGED = "TICKET_TITLE_CHANGED",
  TICKET_DESCRIPTION_CHANGED = "TICKET_DESCRIPTION_CHANGED",
  TICKET_RCA_CREATED = "TICKET_RCA_CREATED",
  TICKET_RCA_UPDATED = "TICKET_RCA_UPDATED",
  TICKET_SUBTICKET_ADDED = "TICKET_SUBTICKET_ADDED",
  TICKET_RELATED_TICKET_ADDED = "TICKET_RELATED_TICKET_ADDED",
  TICKET_RELATED_TICKET_REMOVED = "TICKET_RELATED_TICKET_REMOVED",
  CHANNEL_MESSAGE = "CHANNEL_MESSAGE",
  MENTION = "MENTION",
  DIRECT_MESSAGE = "DIRECT_MESSAGE",
  WORKFLOW_COMPLETION = "WORKFLOW_COMPLETION",
  WORKFLOW_FAILURE = "WORKFLOW_FAILURE",
  THREAD_REPLY = "THREAD_REPLY",
  EMAIL_REPLY_RECEIVED = "EMAIL_REPLY_RECEIVED",
  MESSAGE_DELETED = "MESSAGE_DELETED",
  MESSAGE_EDITED = "MESSAGE_EDITED",
  STAGE_APPROVAL_REQUESTED = "STAGE_APPROVAL_REQUESTED",
  STAGE_APPROVAL_APPROVED = "STAGE_APPROVAL_APPROVED",
  STAGE_APPROVAL_REJECTED = "STAGE_APPROVAL_REJECTED",
  CHANNEL_READ = "CHANNEL_READ",
  THREAD_READ = "THREAD_READ",
  INCOMING_CALL = "INCOMING_CALL",
  MISSED_CALL = "MISSED_CALL",
  CALL_DISMISS = "CALL_DISMISS",
  CALL_REMINDER = "CALL_REMINDER",
  CALL_SCHEDULED = "CALL_SCHEDULED",
  CALL_UPDATED = "CALL_UPDATED",
  EMAIL_FETCH_COMPLETED = "EMAIL_FETCH_COMPLETED",
  EMAIL_FETCH_FAILED = "EMAIL_FETCH_FAILED",
  EMAIL_BACKFILL_REQUIRED = "EMAIL_BACKFILL_REQUIRED",
  CANVAS_SHARED = "CANVAS_SHARED",
  RECORDING_SHARED = "RECORDING_SHARED",
  RECORDING_SUMMARY_READY = "RECORDING_SUMMARY_READY",
  SUMMARY_TEMPLATE_SHARED = "SUMMARY_TEMPLATE_SHARED",
  COLLECTION_INGESTION_COMPLETED = "COLLECTION_INGESTION_COMPLETED",
  MAX_WORKLOAD_REACHED = "MAX_WORKLOAD_REACHED",
  ASSIGNMENT_PAUSED = "ASSIGNMENT_PAUSED",
  ASSIGNMENT_RESUMED = "ASSIGNMENT_RESUMED",
}

// @ts-ignore TS1294
export enum NotificationStatus {
  UNREAD = 'UNREAD',
  READ = 'READ',
  DISMISSED = 'DISMISSED',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
}

// @ts-ignore TS1294
export enum NotificationDeliveryMethod {
  BROWSER = "BROWSER",
  EMAIL = "EMAIL",
  SLACK = "SLACK",
  MOBILE = "MOBILE",
  IOS = "IOS",
  ANDROID = "ANDROID",
}

// @ts-ignore TS1294
export enum NotificationLevel {
  ALL = "ALL",
  MENTIONS_ONLY = "MENTIONS_ONLY",
  THREADS_ONLY = "THREADS_ONLY",
  NONE = "NONE",
}

// @ts-ignore TS1294
export enum CanvasVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

// @ts-ignore TS1294
export enum CanvasRole {
  OWNER = 'OWNER',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

// @ts-ignore TS1294
export enum CanvasCommentThreadStatus {
  OPEN = 'OPEN',
  RESOLVED = 'RESOLVED',
}

// @ts-ignore TS1294
export enum DashboardVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

// @ts-ignore TS1294
export enum DashboardRole {
  OWNER = 'OWNER',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

// @ts-ignore TS1294
export enum DocType {
  Canvas = 'Canvas',
  Quarto = 'Quarto',
}

// @ts-ignore TS1294
export enum BookmarkEntityType {
  MESSAGE = 'MESSAGE',
  CONVERSATION = 'CONVERSATION',
  TICKET = 'TICKET',
  CANVAS = 'CANVAS',
}

// @ts-ignore TS1294
export enum LinkVisibility {
  DEFAULT = 'DEFAULT',
  PERSONAL = 'PERSONAL',
}

// @ts-ignore TS1294
export enum EmailType {
  DEFAULT = 'DEFAULT',
  REPLY = 'REPLY',
  REPLY_ALL = 'REPLY_ALL',
  COMPOSE = 'COMPOSE',
}

// @ts-ignore TS1294
export enum ChannelType {
  DEFAULT = 'DEFAULT',
  EMAIL = 'EMAIL',
  SUPPORT = 'SUPPORT',
  SLACK = 'SLACK',
  APP = 'APP',
  CALL = 'CALL',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  // SDLC repository channel: system-managed, hidden from the chat surfaces
  // the same way SUPPORT channels are (inline type checks).
  SDLC = 'SDLC',
}

// @ts-ignore TS1294
export enum DeskType {
  EMAIL = 'EMAIL',
  DL = 'DL',
  SLACK = 'SLACK',
  APP = 'APP',
  CALL = 'CALL',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
}

// @ts-ignore TS1294
export enum ExternalEntityType {
  MESSAGE = 'MESSAGE',
  EMAIL = 'EMAIL',
  TICKET = 'TICKET',
  ATTACHMENT = 'ATTACHMENT',
  CANVAS = 'CANVAS',
}

// @ts-ignore TS1294
export enum FormFieldType {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  DATE = 'DATE',
  SINGLE_SELECT = 'SINGLE_SELECT',
  MULTI_SELECT = 'MULTI_SELECT',
  USER = 'USER',
  DOC = 'DOC',
}

// @ts-ignore TS1294
export enum FormContextType {
  BOARD = 'BOARD',
  RELEASE_CHANGE = 'RELEASE_CHANGE',
  STAGE = 'STAGE',
}

// @ts-ignore TS1294
export enum BoardType {
  DEFAULT = 'DEFAULT',
  RELEASE = 'RELEASE',
  NON_LINEAR = 'NON_LINEAR',
  FLOW = 'FLOW',
}

// @ts-ignore TS1294
export enum FormEntityType {
  TICKET = 'TICKET',
  SUB_TICKET = 'SUB_TICKET',
  RELEASE_MIGRATION_FORM = "RELEASE_MIGRATION_FORM",
  RELEASE_ENV_FORM = "RELEASE_ENV_FORM",
}

// @ts-ignore TS1294
export enum SurfaceAreaType {
  MESSAGE = 'MESSAGE',
  TICKET = 'TICKET',
  CANVAS = 'CANVAS',
  CALL = 'CALL',
  CONVERSATION = 'CONVERSATION',
}

// @ts-ignore TS1294
export enum SurfaceLinkKind {
  RELATES_TO = 'RELATES_TO',
}

// @ts-ignore TS1294
export enum NudgeKind {
  CREATE_TICKET_FROM_MESSAGE = 'CREATE_TICKET_FROM_MESSAGE',
  FIND_RELATED_TICKET_FROM_MESSAGE = 'FIND_RELATED_TICKET_FROM_MESSAGE',
  FIND_RELATED_MESSAGE_FROM_MESSAGE = 'FIND_RELATED_MESSAGE_FROM_MESSAGE',
  LINK_PASTE_TO_SURFACE = 'LINK_PASTE_TO_SURFACE',
  FORWARD_MESSAGE_LINK = 'FORWARD_MESSAGE_LINK',
  DELETE_MESSAGE_CLEANUP = 'DELETE_MESSAGE_CLEANUP',
  SCHEDULE_CALL_FROM_THREAD = 'SCHEDULE_CALL_FROM_THREAD',
}

// @ts-ignore TS1294
export enum NudgeState {
  ACTIVE = 'ACTIVE',
  DISMISSED = 'DISMISSED',
  ACTED_ON = 'ACTED_ON',
}

// @ts-ignore TS1294
export enum LookupType {
  TICKET_TYPE = 'TICKET_TYPE',
  COE_ACTION_TYPE = 'COE_ACTION_TYPE',
  COE_ACTION_TYPE_RELIABILITY_CHANGE = 'COE_ACTION_TYPE_RELIABILITY_CHANGE',
  COE_ACTION_TYPE_RELIABILITY_CAPACITY = 'COE_ACTION_TYPE_RELIABILITY_CAPACITY',
  COE_ACTION_TYPE_RELIABILITY_FAULT = 'COE_ACTION_TYPE_RELIABILITY_FAULT',
  COE_ACTION_TYPE_PERF = 'COE_ACTION_TYPE_PERF',
  COE_ACTION_TYPE_UIUX = 'COE_ACTION_TYPE_UIUX',
  IMPACT_TYPE = 'IMPACT_TYPE',
  BUG_TYPE = 'BUG_TYPE',
  BUG_CATEGORY_TYPE = 'BUG_CATEGORY_TYPE',
  BUG_ISSUE_TYPE = 'BUG_ISSUE_TYPE',
  BUG_ISSUE_CATEGORY_CAPACITY = 'BUG_ISSUE_CATEGORY_CAPACITY',
  BUG_ISSUE_CATEGORY_CHANGE = 'BUG_ISSUE_CATEGORY_CHANGE',
  BUG_ISSUE_CATEGORY_FAULT = 'BUG_ISSUE_CATEGORY_FAULT',
  BUG_RESOLUTION_CAPACITY = 'BUG_RESOLUTION_CAPACITY',
  BUG_RESOLUTION_CHANGE = 'BUG_RESOLUTION_CHANGE',
  BUG_RESOLUTION_FAULT = 'BUG_RESOLUTION_FAULT',
  QUICK_FIX_OPTION = 'QUICK_FIX_OPTION',
}

// Release Management Enums



// @ts-ignore TS1294
export enum EnvChangeType {
  ADDED = 'ADDED',
  MODIFIED = 'MODIFIED',
  REMOVED = 'REMOVED',
}

// @ts-ignore TS1294
export enum ReleaseEventType {
  RELEASE = 'RELEASE',
  TICKET = 'TICKET',
  SUBTICKET = 'SUBTICKET',
  TESTING = 'TESTING',
  SYSTEM = 'SYSTEM',
  CANVAS = 'CANVAS',
}

// @ts-ignore TS1294
export enum TicketStageRequestStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
export enum ReleaseEnvironment {
  SANDBOX = 'SANDBOX',
  PROD = 'PROD',
}

// @ts-ignore TS1294
export enum ReleaseTicketStatus {
  CREATED = 'CREATED',
  ENV_READY = 'ENV_READY',
  INITIATED = 'INITIATED',
  TESTED = 'TESTED',
  APPROVED = 'APPROVED',
  IN_PROGRESS = 'IN_PROGRESS',
  MONITORING = 'MONITORING',
  COMPLETED = 'COMPLETED',
  REVERTED = 'REVERTED',
}

// @ts-ignore TS1294
export enum ApplicationReleaseStatus {
  PLANNED = 'PLANNED',
  TESTING = 'TESTING',
  APPROVED = 'APPROVED',
  DEPLOYING = 'DEPLOYING',
  DEPLOYED = 'DEPLOYED',
  MONITORING = 'MONITORING',
  STABILIZED = 'STABILIZED',
  FAILED = 'FAILED',
  REVERTING = 'REVERTING',
  REVERTED = 'REVERTED',
}

// @ts-ignore TS1294
export enum RCAStatus {
  DRAFT = 'DRAFT',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  CLOSED = 'CLOSED',
}

// @ts-ignore TS1294
export enum COEStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

// @ts-ignore TS1294
export enum SEVERITY {
  SEV_1 = 'SEV_1',
  SEV_2 = 'SEV_2',
  SEV_3 = 'SEV_3',
}

// @ts-ignore TS1294
export enum AttributionConfidence {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

// @ts-ignore TS1294
export enum VCSProviderType {
  GITHUB = 'GITHUB',
  BITBUCKET_CLOUD = 'BITBUCKET_CLOUD',
  BITBUCKET_SERVER = 'BITBUCKET_SERVER',
}

// @ts-ignore TS1294
export enum ReleaseTrackingMode {
  COMMIT_RANGE = 'COMMIT_RANGE',
  VERSION = 'VERSION',
}

export enum ProjectType {
  DEFAULT = "DEFAULT",
  DM = "DM",
}

// Saved Views Enums

// @ts-ignore TS1294
export enum SavedConfigContextType {
  BOARD = 'BOARD',
}

// @ts-ignore TS1294
export enum SavedConfigVisibility {
  PRIVATE = 'PRIVATE',
  PUBLIC = 'PUBLIC',
}

// @ts-ignore TS1294
export enum SavedConfigEntityName {
  TICKET = 'TICKET',
  FORM_ENTITY_VALUE = 'FORM_ENTITY_VALUE',
}

// Who a saved-view share grant targets. USER today; USER_GROUP / CHANNEL slots reserved.
// @ts-ignore TS1294
export enum ViewAccessEntityType {
  USER = 'USER',
}

// @ts-ignore TS1294
export enum DelayedMessageStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// @ts-ignore TS1294
export enum AttachmentUploadStatus {
  PENDING = 'PENDING',
  STARTED = 'STARTED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// @ts-ignore TS1294
export enum VisitSlaMode {
  STAGE_DEFAULT = 'STAGE_DEFAULT',
  NONE = 'NONE',
  FIXED_HOURS = 'FIXED_HOURS',
}

// @ts-ignore TS1294
export enum ReenterMode {
  RESET = 'RESET',
  CONTINUE = 'CONTINUE',
}

// @ts-ignore TS1294
export enum CollectionRole {
  OWNER = 'OWNER',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER',
}

// @ts-ignore TS1294
export enum IngestionStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum ApproverType {
  USER = 'USER',
  ROLE = 'ROLE',
}

// @ts-ignore TS1294
export enum AppPermissionStatus {
  UNAPPROVED = 'UNAPPROVED',
  APPROVED = 'APPROVED',
  PENDINGDELETE = 'PENDINGDELETE',
}

// @ts-ignore TS1294
export enum AppPermissionType {
  READ = 'READ',
  WRITE = 'WRITE',
}

// @ts-ignore TS1294
export enum NudgeType {
  EXISTING_TICKET = 'EXISTING_TICKET',
  CREATE_TICKET = 'CREATE_TICKET',
  SET_REMINDER = 'SET_REMINDER',
  ADD_TO_KB = 'ADD_TO_KB',
  REVERSE_KB_LOOKUP = 'REVERSE_KB_LOOKUP',
  THREAD_FOLLOW_UP = 'THREAD_FOLLOW_UP',
  DECISION_PENDING = 'DECISION_PENDING',
  WAITING_ON_BLOCKED_BY = 'WAITING_ON_BLOCKED_BY',
}

// @ts-ignore TS1294
export enum QueryType {
  internal = 'internal',
  external = 'external',
}

// @ts-ignore TS1294
export enum RecordingStatus {
  RECORDING_ACTIVE = 'RECORDING_ACTIVE',
  RECORDING_STOPPED = 'RECORDING_STOPPED',
  PROCESSING_RECORDING = 'PROCESSING_RECORDING',
  RECORDING_UPLOADED = 'RECORDING_UPLOADED',
  RECORDING_FAILED = 'RECORDING_FAILED',
  RECORDING_UPLOAD_FAILED = 'RECORDING_UPLOAD_FAILED',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  RECORDING_EXPIRED = 'RECORDING_EXPIRED',
  RECORDING_DELETED = 'RECORDING_DELETED',
}

// @ts-ignore TS1294
export enum SessionRecordingProcessStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// @ts-ignore TS1294
export enum TagMethod {
  MANUAL = 'MANUAL',
  LLM = 'LLM',
  AUTOMATED = 'AUTOMATED',
}

// @ts-ignore TS1294
export enum TeamIntelligenceBatchStatus {
  RECEIVED = 'RECEIVED',
  QUEUED = 'QUEUED',
  PARTIALLY_QUEUED = 'PARTIALLY_QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// @ts-ignore TS1294
export enum TeamIntelligenceUserIngestionStatus {
  RECEIVED = 'RECEIVED',
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// @ts-ignore TS1294
export enum TelepresenceDeviceType {
  TV = 'TV',
  CAMERA = 'CAMERA',
  MICROPHONE = 'MICROPHONE',
  SPEAKER = 'SPEAKER',
}

// @ts-ignore TS1294
export enum TelepresenceHealthStatus {
  HEALTHY = 'HEALTHY',
  DEGRADED = 'DEGRADED',
  UNAVAILABLE = 'UNAVAILABLE',
  UNKNOWN = 'UNKNOWN',
}

// @ts-ignore TS1294
export enum VespaInsertionStatus {
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  FAILED_MAX_RETRIES = 'FAILED_MAX_RETRIES',
}

// @ts-ignore TS1294
export enum VespaOperationType {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  POST_INGEST_CLEAN = 'POST_INGEST_CLEAN',
}

// @ts-ignore TS1294
export enum WorkflowEventType {
  NO_OP = 'NO_OP',
  TICKET_CREATED = 'TICKET_CREATED',
  TICKET_UPDATED = 'TICKET_UPDATED',
  TICKET_COMMENTED = 'TICKET_COMMENTED',
  EMAIL_RECEIVED = 'EMAIL_RECEIVED',
  EMAIL_SENT = 'EMAIL_SENT',
  WEBHOOK = 'WEBHOOK',
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  CALL_EVENT = 'CALL_EVENT',
  TAG_GENERATED = 'TAG_GENERATED',
  MANUAL = 'MANUAL',
  CRON = 'CRON',
  EVENT = 'EVENT',
  WEBHOOK_V2 = 'WEBHOOK_V2',
}

// @ts-ignore TS1294
export enum WorkflowExecutionMode {
  AUTOMATIC = 'AUTOMATIC',
  MANUAL = 'MANUAL',
}

// @ts-ignore TS1294
export enum WorkflowMappingEntityType {
  AUTOMATION_WEBHOOK = 'AUTOMATION_WEBHOOK',
}

// Recording / sharing enums. New Prisma enums are frozen at the DB level (see
// scripts/validate-no-new-enums.sh) — the corresponding columns are plain
// Strings validated app-side. These consts are the single source of truth for
// valid values; import them everywhere instead of hardcoding string literals.
export const ShareableEntityType = {
  NOTE_TAKER: 'NOTE_TAKER',
  SUMMARY_TEMPLATE: 'SUMMARY_TEMPLATE',
} as const;

export type ShareableEntityType = typeof ShareableEntityType[keyof typeof ShareableEntityType];

export const SummaryTemplateVisibility = {
  PRIVATE: 'PRIVATE',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  PUBLIC: 'PUBLIC',
} as const;

export type SummaryTemplateVisibility =
  typeof SummaryTemplateVisibility[keyof typeof SummaryTemplateVisibility];

export const EntityUserAccess = {
  VIEW: 'VIEW',
  EDIT: 'EDIT',
  ADMIN: 'ADMIN',
  REVOKED: 'REVOKED',
} as const;

export type EntityUserAccess = typeof EntityUserAccess[keyof typeof EntityUserAccess];

// Role that may be granted when sharing/updating access. REVOKED is reached via
// update/revoke, not by explicitly "sharing" with that role.
export type GrantableEntityUserAccess = Exclude<EntityUserAccess, 'REVOKED'>;

export const DefaultOutlet = {
  EMAIL: 'EMAIL',
  MESSAGE: 'MESSAGE',
} as const;

export type DefaultOutlet = typeof DefaultOutlet[keyof typeof DefaultOutlet];

export enum Platform {
  WEB = 'WEB',
  ELECTRON = 'ELECTRON',
  MOBILE = 'MOBILE',
}

export enum TriggerType {
  CLICK = 'CLICK',
  CHANGE = 'SELECTION_CHANGE',
  BLUR = 'INPUT_CHANGE',
  DB_MUTATION = 'DB_MUTATION',
}

export enum BaseTicketType {
  Fix = 'Fix',
  Feature = 'Feature',
  Story = 'Story',
  Hotfix = 'Hotfix',
  Release = 'Release',
  Support = 'Support',
  DESK = 'DESK',
  Epic = 'Epic',
}
