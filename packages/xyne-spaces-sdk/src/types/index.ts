/**
 * Type Definitions
 *
 * Core types for entities returned by the SDK.
 * These mirror the Zero schema types but are simplified for SDK consumers.
 */

// ----- User Types -----

export interface User {
  id: string;
  email: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  workspaceId: string;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  id: string;
  userId: string;
  bio: string | null;
  title: string | null;
  phoneNumber: string | null;
  timezone: string | null;
  location: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserPresence {
  userId: string;
  status: 'online' | 'away' | 'dnd' | 'offline';
  statusText: string | null;
  lastSeenAt: number;
  updatedAt: number;
}

// ----- Enums -----
//
// String unions rather than TS enums so the SDK stays dependency-free and the
// values are usable as plain strings by consumers.

export type MessageType = 'USER' | 'BOT' | 'SYSTEM' | 'FORWARDED';
export type ChannelRole = 'ADMIN' | 'MEMBER';
export type ChannelSortOrder = 'ALPHABETICAL' | 'RECENT_ACTIVITY' | 'MANUAL';

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

export interface SearchOptions {
  q?: string;
  type?: string | string[];
  channelId?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
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
