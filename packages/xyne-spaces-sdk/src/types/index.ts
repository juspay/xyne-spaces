/**
 * Type Definitions
 *
 * Core types for entities returned by the SDK.
 * These mirror the Zero schema types but are simplified for SDK consumers.
 */

// ----- User Types -----

/**
 * A workspace member.
 *
 * Field names match the `users` table. Note `picture` rather than `avatarUrl`,
 * and that departure is expressed by `status` plus a `leftAt` timestamp — there
 * is no `isDeleted` flag.
 *
 * Several presence fields are denormalised onto this row so the directory can be
 * rendered without a second read; `user_presence` remains the source of truth.
 */
export interface User {
  id: string;
  name: string;
  email: string;
  picture: string | null;
  displayName: string | null;
  workspaceId: string;
  /** Workspace role: OWNER, ADMIN, MEMBER, GUEST. */
  role: string;
  /** Links to the org membership row; some operations need this id. */
  orgMemberId: string;
  authProvider: string;
  providerUserId: string;
  /** Account state, e.g. ACTIVE or INACTIVE. */
  status: string;
  /** Distinguishes humans from bots and app users. */
  userType: string;
  /** Set when the member left the workspace. */
  leftAt: number | null;
  calendarVisibility: string;
  // Denormalised presence, dual-written from user_presence.
  statusEmoji: string | null;
  statusContent: string | null;
  statusExpiryAt: number | null;
  lastActiveAt: number | null;
  notificationsPausedUntil: number | null;
  assignmentUnavailableUntil: number | null;
  metadata: unknown;
  createdAt: number;
  updatedAt: number;
}

/**
 * The optional profile card a user fills in.
 *
 * Separate from `User`: this is self-authored detail, not account state.
 */
export interface UserProfile {
  id: string;
  userId: string;
  workspaceId: string;
  displayName: string | null;
  /** Job title or role description, free text. */
  role: string | null;
  team: string | null;
  /** Manager's user id. */
  manager: string | null;
  phoneNumber: string | null;
  /** How to say the person's name. */
  pronunciation: string | null;
  /** Date of birth, epoch milliseconds. */
  dob: number | null;
  /** When they joined, epoch milliseconds. */
  joinedOn: number | null;
  hasVoiceSignature: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserPresence {
  id: string;
  userId: string;
  workspaceId: string;
  /** Presence state, e.g. ONLINE, AWAY, OFFLINE. */
  status: string;
  lastActiveAt: number;
  lastSeenAt: number;
  /** True when the user set this status themselves rather than it being inferred. */
  isManual: boolean;
  deviceInfo: string | null;
  statusEmoji: string | null;
  statusContent: string | null;
  statusExpiryAt: number | null;
  assignmentUnavailableUntil: number | null;
  notificationsPausedUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

// ----- Enums -----
//
// String unions rather than TS enums so the SDK stays dependency-free and the
// values are usable as plain strings by consumers.

export type MessageType = 'USER' | 'BOT' | 'SYSTEM' | 'FORWARDED';
export type ChannelRole = 'ADMIN' | 'MEMBER';
export type ChannelSortOrder = 'ALPHABETICAL' | 'RECENT_ACTIVITY' | 'MANUAL';
export type ChannelScopeType = 'DEFAULT' | 'DM' | 'TICKET' | 'DOCUMENT' | 'GROUP_DM';
export type ChannelVisibility = 'PUBLIC' | 'PRIVATE';
export type ChannelType = 'DEFAULT' | 'EMAIL' | 'SUPPORT' | 'SLACK' | 'APP' | 'CALL';
export type DeskType = 'EMAIL' | 'DL' | 'SLACK' | 'APP' | 'CALL';

// ----- Channel Types -----

/**
 * A channel. Field names match the `channels` table exactly — note `type` and
 * `visibility` rather than a boolean `isPrivate`, and `createdBy` rather than
 * `createdByUserId`.
 */
export interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: string;
  scopeType: string;
  visibility: string;
  createdBy: string;
  projectId: string;
  workspaceId: string;
  participantCount: number;
  isArchived: boolean;
  lastActivityAt: number;
  addUserPolicy: string | null;
  showTicketsTabTicketsInChat: boolean | null;
  callSummaryPrompt: string | null;
  metadata: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelParticipant {
  id: string;
  channelId: string;
  userId: string;
  role: ChannelRole;
  joinedAt: number;
}

/**
 * Per-user state for a channel: read position, starring, section placement, and
 * notification overrides. One row per (channel, user).
 */
export interface ChannelUserStatus {
  id: string;
  channelId: string;
  userId: string;
  workspaceId: string;
  lastViewedAt: number;
  lastViewedConversationId: string | null;
  isStarred: boolean;
  isClosed: boolean;
  unreadCount: number;
  sectionId: string | null;
  sectionPosition: string | null;
  selectedBoardId: string | null;
  conversationSeenCutoffAt: number;
  isRecapSubscribed: boolean;
  desktopNotificationLevel: string | null;
  mobileNotificationLevel: string | null;
  threadReplyNotificationsEnabled: boolean | null;
}

/** A user's sidebar grouping of channels. */
export interface ChannelSection {
  id: string;
  userId: string;
  workspaceId: string;
  name: string;
  emoji: string | null;
  position: string;
  isCollapsed: boolean;
  isDeleted: boolean;
  sortOrder: ChannelSortOrder | null;
  createdAt: number;
  updatedAt: number | null;
}

/** Input accepted by `sdk.channels.create`. */
export interface CreateChannelInput {
  scopeType: ChannelScopeType;
  projectId: string;
  scopeId?: string;
  name?: string;
  description?: string;
  visibility?: ChannelVisibility;
  participants?: string[];
  type?: ChannelType;
  assigneeUserGroupId?: string;
  deskType?: DeskType;
  dlEmail?: string;
  slackChannelId?: string;
  installedAppId?: string;
  boardId?: string;
}

export interface CheckDuplicateChannelResponse {
  isDuplicate: boolean;
  name: string;
  projectId: string;
}

// ----- Message Types -----

/**
 * A message. The primary key is `messageId`, not `id`, and the type column is
 * `msgType` — both match the underlying table.
 */
export interface Message {
  messageId: string;
  conversationId: string;
  childConversationId: string | null;
  senderId: string;
  workspaceId: string;
  content: string;
  msgType: MessageType;
  hasAttachment: boolean;
  edited: boolean;
  isDeleted: boolean;
  showInChannel: boolean;
  /** When set, the message is only visible to this user (ephemeral replies). */
  visibleTo: string | null;
  isSent: boolean;
  nudgeCount: number | null;
  metadata: unknown;
  createdAt: number;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  createdAt: number;
}

/**
 * A file passed to a multipart SDK operation.
 *
 * Browser `File` objects can be passed directly. Use the object form for a
 * plain `Blob`, an explicit filename, dimensions, or a generated thumbnail.
 */
export type UploadFileInput =
  | Blob
  | {
      file: Blob;
      filename?: string;
      thumbnail?: Blob;
      thumbnailFilename?: string;
      width?: number;
      height?: number;
      duration?: number;
    };

export interface UploadedAttachment {
  id: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  url: string;
  thumbnailUrl?: string | null;
}

export interface AttachmentUploadResponse {
  success: boolean;
  count: number;
  attachments: UploadedAttachment[];
}

export interface DraftAttachmentUploadResult {
  attachmentId: string;
  fileUrl?: string;
  success: boolean;
  error?: string;
}

export interface DraftAttachmentUploadResponse {
  success: boolean;
  uploadedAttachments: DraftAttachmentUploadResult[];
  totalCount: number;
  successCount: number;
  failureCount: number;
}

export interface Reaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: number;
}

// ----- Conversation Types -----

/** A thread. Primary key is `conversationId`. */
export interface Conversation {
  conversationId: string;
  channelId: string;
  workspaceId: string;
  createdBy: string;
  initialMessageId: string;
  parentMessageId: string | null;
  lastActivityAt: number;
  replyCount: number;
  pinned: boolean;
  ticketId: string | null;
  callId: string | null;
  threadType: string | null;
  doNotPostToChannel: boolean | null;
  metadata: unknown;
  createdAt: number;
}

export interface ConversationParticipant {
  id: string;
  conversationId: string;
  userId: string;
  channelId: string | null;
  workspaceId: string;
  participationType: string | null;
  isSubscribed: boolean;
  joinedAt: number;
  lastReadAt: number | null;
  lastReplyAt: number | null;
}

export interface CreateConversationWithAttachmentsInput {
  channelId: string;
  files: UploadFileInput[];
  content?: string;
  msgType?: 'USER' | 'BOT';
  visibleTo?: string | null;
}

// ----- Activity Types -----

/** An entry in a user's activity feed (mentions, replies, reactions, calls). */
export interface Activity {
  id: string;
  userId: string;
  workspaceId: string;
  actorId: string;
  actorAction: string;
  actionSource: string;
  actionSourceId: string;
  messageId: string | null;
  reactionId: string | null;
  callId: string | null;
  ticketId: string | null;
  conversationId: string | null;
  channelId: string | null;
  canvasId: string | null;
  classification: string;
  createdAt: number;
}

// ----- Ticket Types -----

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketStatusV2 = 'TODO' | 'STARTED' | 'PAUSED' | 'CANCELLED' | 'COMPLETED';

/**
 * A ticket. Note the stage is referenced by `stageName`, not a stage id, and
 * assignment is `assignedTo` — both match the underlying table.
 */
export interface Ticket {
  id: string;
  /** Human-readable key, e.g. `PLAT-1234`. */
  xyneId: string;
  title: string;
  description: string;
  status: string;
  statusV2: TicketStatusV2;
  priority: TicketPriority;
  stageName: string;
  boardId: string;
  projectId: string;
  workspaceId: string;
  userGroupId: string;
  channelId: string;
  conversationId: string;
  assignedTo: string | null;
  createdBy: string;
  updatedBy: string;
  ticketType: string | null;
  merchantId: string | null;
  eta: number | null;
  isArchived: boolean;
  kanbanPosition: string | null;
  closedAt: number | null;
  closedBy: string | null;
  statusUpdatedAt: number;
  metadata: unknown;
  createdAt: number;
  updatedAt: number;
}

/** Input accepted by the server-side ticket creation workflow. */
export interface CreateTicketInput {
  title: string;
  description: string;
  projectId: string;
  boardId?: string;
  channelId?: string;
  sourceConversationId?: string;
  assignedTo?: string;
  userGroupId?: string;
  statusV2?: TicketStatusV2;
  priority?: TicketPriority;
  eta?: Date | string;
  metadata?: Record<string, unknown>;
  closedAt?: Date | string;
  closedBy?: string;
  excludedChatAttachmentIds?: string[];
  draftAttachmentIds?: string[];
  dynamicFields?: Record<string, string | string[]>;
  workflowType?: string;
  stageName?: string;
  tags?: string[];
  merchantId?: string;
  parentTicketId?: string;
  ticketType?: string;
  fromTicketsTab?: boolean;
  files?: UploadFileInput[];
}

export interface CreateTicketResponse {
  id: string;
  conversationId: string;
  xyneId: string;
}

export interface SubTicket {
  id: string;
  title: string;
  description: string | null;
  workspaceId: string;
  mappedTicketId: string | null;
  conversationId: string | null;
  assignedTo: string | null;
  stageProgression: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Board {
  id: string;
  name: string;
  description: string | null;
  boardType: string;
  projectId: string;
  workspaceId: string;
  createdBy: string;
  updatedBy: string | null;
  vcsProvider: string | null;
  releaseTrackingMode: string | null;
  metadata: unknown;
  createdAt: number;
  updatedAt: number | null;
}

/**
 * A stage on a board. Ordering comes from `sequenceNumber`, and tickets point at
 * stages by `name` rather than by id.
 */
export interface Stage {
  id: string;
  name: string;
  boardId: string;
  workspaceId: string;
  sequenceNumber: number;
  eta: number | null;
  defaultTicketStatus: string | null;
  defaultTicketStatusV2: TicketStatusV2;
  requestApprovalOnEntry: boolean | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number | null;
}

export interface Project {
  id: string;
  name: string;
  /** Short prefix used in ticket keys, e.g. `PLAT`. */
  code: string;
  description: string | null;
  type: string;
  workspaceId: string;
  ticketSequence: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number | null;
}

export type StageRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/** A request to move a ticket into a stage that requires approval. */
export interface TicketStageRequest {
  id: string;
  ticketId: string;
  stageId: string;
  workspaceId: string;
  formId: string | null;
  status: StageRequestStatus;
  submittedBy: string;
  reviewedBy: string | null;
  reviewerCommentMessageId: string | null;
  updatedBy: string;
  createdAt: number;
  updatedAt: number;
}

// ----- Canvas Types -----

export type CanvasVisibility = 'PUBLIC' | 'PRIVATE';
export type CanvasRole = 'OWNER' | 'EDITOR' | 'VIEWER';
export type CanvasCommentThreadStatus = 'OPEN' | 'RESOLVED';

/**
 * A collaborative document.
 *
 * `content` is a BlockNote block array, not markdown or HTML. `viewAccessId` and
 * `editAccessId` are the share-link tokens that appear in canvas URLs.
 */
export interface Canvas {
  id: string;
  title: string;
  content: unknown;
  workspaceId: string;
  channelId: string | null;
  folderId: string | null;
  projectId: string | null;
  createdBy: string;
  viewAccessId: string | null;
  editAccessId: string | null;
  visibility: CanvasVisibility;
  isTemplate: boolean;
  /** When true the document is edited through the realtime CRDT server. */
  isCollaborative: boolean;
  docType: string;
  lastEditedBy: string | null;
  lastEditedAt: number | null;
  metadata: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasFolder {
  id: string;
  name: string;
  workspaceId: string;
  projectId: string | null;
  channelId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasParticipant {
  id: string;
  canvasId: string;
  workspaceId: string;
  /** Exactly one of userId / userGroupId / channelId is set. */
  userId: string | null;
  userGroupId: string | null;
  channelId: string | null;
  role: CanvasRole;
  joinedAt: number;
  updatedAt: number;
}

/** A comment thread anchored to a block within a canvas. */
export interface CanvasCommentThread {
  id: string;
  canvasId: string;
  blockId: string;
  anchorText: string | null;
  initialCommentId: string | null;
  status: CanvasCommentThreadStatus;
  statusUpdatedBy: string | null;
  statusUpdatedAt: number | null;
  createdBy: string;
  createdAt: number;
}

export interface CanvasComment {
  id: string;
  threadId: string;
  canvasId: string;
  body: string;
  /** Comma-separated user ids, as stored. */
  mentionedUserIds: string;
  isInitial: boolean;
  createdBy: string;
  editedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
}

export interface CanvasVersion {
  id: string;
  canvasId: string;
  workspaceId: string;
  name: string;
  content: unknown;
  contentHash: string;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

// ----- Collection Types -----

/**
 * A knowledge-base collection. Collections nest: `parentId` is the immediate
 * parent and `rootCollectionId` the top of the tree.
 */
export interface Collection {
  id: string;
  name: string;
  description: string | null;
  workspaceId: string;
  ownerId: string;
  parentId: string | null;
  rootCollectionId: string | null;
  scopeType: string;
  scopeId: string;
  isPrivate: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** A file in a collection. Versioned — `isLatest` marks the current revision. */
export interface CollectionItem {
  id: string;
  name: string;
  collectionId: string;
  rootCollectionId: string;
  workspaceId: string;
  fileId: string;
  ownerId: string;
  uploadedById: string | null;
  ingestionStatus: string;
  versionNumber: number;
  isLatest: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

// ----- Form Types -----

export interface Form {
  id: string;
  formName: string;
  formDescription: string | null;
  entityType: string;
  contextType: string;
  workspaceId: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface FormField {
  id: string;
  formId: string;
  workspaceId: string;
  globalFieldId: string | null;
  fieldName: string | null;
  fieldType: string | null;
  fieldEnum: unknown;
  fieldOptions: string | null;
  isOptional: boolean | null;
  sequenceNumber: number | null;
  parentOptionId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A value submitted for one form field against one entity (e.g. a ticket). */
export interface FormEntityValue {
  id: string;
  entityId: string;
  entityType: string;
  formId: string;
  fieldId: string;
  workspaceId: string;
  contextId: string | null;
  version: number | null;
  fieldValue: string;
  actualFieldValue: unknown;
  createdAt: number;
  updatedAt: number;
}

// ----- Call Types -----

export type CallStatus = 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'CANCELLED' | 'MISSED';

/**
 * A call. Live media is handled by the realtime server — `externalId` and
 * `roomLink` point at the provisioned room, and this row is its metadata.
 */
export interface Call {
  id: string;
  channelId: string;
  workspaceId: string;
  callType: string;
  status: CallStatus;
  externalId: string;
  roomLink: string | null;
  createdBy: string;
  title: string | null;
  startsAt: number | null;
  endsAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  notesCanvasId: string | null;
  participantCount: number | null;
  seriesId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CallParticipant {
  id: string;
  callId: string;
  userId: string | null;
  workspaceId: string;
  status: string | null;
  joinedAt: number | null;
  leftAt: number | null;
}

// ----- Email Types -----

/**
 * An email draft. Two flavours share this shape: a reply draft carries a
 * `conversationId`, a compose draft does not and carries a `subject` instead.
 */
export interface EmailDraft {
  id: string;
  channelId: string;
  workspaceId: string;
  userId: string;
  conversationId: string | null;
  subject: string | null;
  fromAddress: string | null;
  draftContent: string | null;
  toRecipients: unknown;
  ccRecipients: unknown;
  bccRecipients: unknown;
  attachmentIds: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface EmailSignature {
  id: string;
  name: string;
  content: string;
  userId: string;
  workspaceId: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Per-channel desk configuration: routing, auto-draft, and metrics. */
export interface EmailChannelPreference {
  channelId: string;
  workspaceId: string;
  ownerUserId: string | null;
  assigneeUserGroupId: string | null;
  sendAsEmail: boolean | null;
  defaultCc: unknown;
  emailMergeMode: string | null;
  twoStepSendEnabled: boolean | null;
  autoDraftMode: string | null;
  autoDraftAgentSlug: string | null;
  metricsEnabled: boolean | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationLabel {
  id: string;
  name: string;
  color: string | null;
  channelId: string;
  workspaceId: string;
  createdBy: string;
  createdAt: number;
}

// ----- Recap Types -----

/** A generated summary of a channel's activity for one day. */
export interface Recap {
  id: string;
  channelId: string;
  workspaceId: string;
  recapDate: number;
  content: string | null;
  createdAt: number;
  updatedAt: number;
}

// ----- Search Types -----

export interface SearchResult {
  id: string;
  type: 'message' | 'ticket' | 'file' | 'channel' | 'call' | 'user';
  score: number;
  highlight?: Record<string, string[]>;
  data: unknown;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  facets?: Record<string, Array<{ value: string; count: number }>>;
}

/**
 * Search parameters.
 *
 * Names match the server's query contract exactly. Note `orderBy` — an earlier
 * version of this SDK sent `sortBy`/`sortOrder`, which exist in neither search
 * validator, so sorting silently did nothing.
 */
export interface SearchOptions {
  /** Free text. Omit to search by filters alone. */
  q?: string;
  /** Restrict to result types, e.g. `'messages'` or `['messages','tickets']`. */
  type?: string | string[];
  /** Apps to search: `chat`, `ticket`, `user`, `file`. */
  apps?: string | string[];
  subApp?: 'canvas' | 'transcript' | 'recording' | 'rca' | 'collections';

  limit?: number;
  offset?: number;

  /**
   * Result ordering. `'newest'` is what you want for "the latest N" — the default
   * is relevance, which cannot be paged through time reliably.
   */
  orderBy?: 'newest' | 'oldest' | 'relevance';
  /** Pass `''` to disable grouping and get one flat ranked list. */
  groupBy?: string;

  // Who and where.
  /** Sender user id(s). */
  from?: string | string[];
  withUser?: string | string[];
  fromEmail?: string | string[];
  toEmail?: string | string[];
  /** Channel id(s) to search within. */
  in?: string | string[];
  mentions?: string | string[];
  channelMentions?: string | string[];

  // Work-item filters.
  projectId?: string | string[];
  status?: string | string[];
  ticketId?: string | string[];
  priority?: string;
  board?: string;
  tags?: string;
  stage?: string;
  assignee?: string;

  // Dates. `range` takes natural windows ('today', 'last 7 days'); the rest are cutoffs.
  before?: string;
  after?: string;
  on?: string;
  range?: string;
  created?: string;

  // Calls.
  callStatus?: string;
  callType?: string;
  callStartsAt?: number;
  callEndsAt?: number;

  // Noise controls.
  includeBotMessages?: boolean;
  onlyMyChannels?: boolean;

  /**
   * @deprecated The server has no `channelId` parameter — this used to be rejected.
   * Kept as an alias for `in`, which is the channel filter. Prefer `in`.
   */
  channelId?: string;
  /**
   * @deprecated Never worked — the server has no such parameter. Use `orderBy`.
   */
  sortBy?: never;
  /**
   * @deprecated Never worked — the server has no such parameter. Use `orderBy`.
   */
  sortOrder?: never;
}

// ----- Flow Plan (flow boards) -----

/**
 * What must happen before a flow step opens.
 *
 * Mirrors `FlowStepGateSchema` in `@xyne/shared`. Declared locally because the SDK
 * ships with no dependencies.
 */
export type FlowStepGate =
  | { type: 'confirmation'; prompt?: string }
  | { type: 'form'; formId: string };

export interface FlowPlanNode {
  id: string;
  title: string;
  description?: string;
  assignedTo?: string | null;
  parentIds: string[];
  order: number;
  gate?: FlowStepGate;
  groupId?: string | null;
}

export interface FlowPlanGroup {
  id: string;
  name: string;
  parentIds: string[];
  order?: number;
  groupId?: string | null;
}

export interface FlowDecisionRoute {
  key: string;
  label: string;
  value?: string;
  targetId: string;
}

export interface FlowPlanDecision {
  id: string;
  parentNodeId: string;
  fieldId: string;
  fieldName: string;
  fieldType: 'STRING' | 'BOOLEAN' | 'SINGLE_SELECT';
  operator?: 'equals' | 'notEquals';
  comparisonValue?: string;
  routes: FlowDecisionRoute[];
}

/** A flow board's DAG of steps. `version` is pinned to 2; v1 plans are migrated on read. */
export interface FlowPlan {
  version: 2;
  nodes: FlowPlanNode[];
  groups?: FlowPlanGroup[];
  decisions?: FlowPlanDecision[];
  updatedAt: number;
}

// ----- Claw Types (remote agents) -----

/** A remote agent that can be dispatched to. */
export interface ClawAgent {
  slug: string;
  name?: string;
  description?: string;
}

/** A past or in-flight agent run, as listed. */
export interface ClawSession {
  sessionId: string;
  agentSlug?: string;
  status?: string;
  title?: string;
  createdAt?: string;
}

/** The outcome of one agent run. */
export interface ClawRun {
  sessionId: string;
  status: string;
  result?: string;
  error?: string;
}

export interface ClawRunInput {
  /** Agent slug, from `listAgents()`. */
  agent: string;
  /** The task or prompt to send. */
  task: string;
  /**
   * Reuse an existing conversation to continue a thread. One is generated when
   * omitted — the run is not pollable without it.
   */
  conversationId?: string;
  /** Post the agent's reply into this Spaces channel or DM. */
  channelId?: string;
  /** Ask the server to deliver the reply to the caller's own Spaces DM. */
  deliverTo?: 'dm';
}

/** What the user must see to complete a device-flow login. */
export interface ClawDevicePrompt {
  /** URL the user opens to authorize. */
  verifyUrl: string;
  /** Code the user confirms on that page. */
  userCode: string;
  /** Seconds until the request expires. */
  expiresIn: number;
}

export interface ClawLoginResult {
  token: string;
  userId?: string;
  email?: string;
}

// ----- Pagination Types -----

export interface PaginatedResponse<T> {
  data: T[];
  cursor?: string;
  hasMore: boolean;
}

export interface PaginationOptions {
  limit?: number;
  cursor?: string;
}
