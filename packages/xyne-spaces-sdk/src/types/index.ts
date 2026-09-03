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
export type ChannelSortOrder = 'UNREAD' | 'RECENCY' | 'ALPHABETICAL';
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

/** What kind of record an attachment hangs off. */
export type AttachmentEntityType =
  | 'TICKET'
  | 'CHAT'
  | 'CANVAS'
  | 'DRAFT'
  | 'DELAYED_MESSAGE'
  | 'EMAIL'
  | 'IMPACT'
  | 'COLLECTION'
  | 'FORM_ENTITY_VALUE'
  | 'WORKFLOW_STEPS'
  | 'DESK_REPORT';

/** How far an upload has got. */
export type AttachmentUploadStatus = 'PENDING' | 'STARTED' | 'COMPLETED' | 'FAILED';

/**
 * An uploaded file.
 *
 * Attachments are not owned by messages alone — `entityType` says what the file
 * hangs off, and `entityId` names it, so the same shape covers a ticket
 * attachment, a canvas image and an email file.
 */
export interface MessageAttachment {
  id: string;
  workspaceId: string;
  entityType: AttachmentEntityType;
  /** Id of the record this file belongs to. */
  entityId: string;
  /** Thread the file was posted in, where there is one. */
  conversationId?: string;
  originalFilename: string;
  mimetype: string;
  /** Size in bytes. */
  size: number;
  width?: number;
  height?: number;
  url: string;
  thumbnailUrl?: string;
  storageProvider: string;
  uploadedByUserId: string;
  createdBy: string;
  uploadStatus?: AttachmentUploadStatus;
  /** Order within a multi-file upload. */
  position?: number;
  isDeleted: boolean;
  metadata?: unknown;
  /** Epoch milliseconds. */
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

/** Lifecycle of an SDLC track. Mirrors `SDLC_TRACK_STATUSES` in @xyne/shared. */
export type SdlcTrackStatus = 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

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
  stageName?: string;
  tags?: string[];
  merchantId?: string;
  parentTicketId?: string;
  ticketType?: string;
  fromTicketsTab?: boolean;
  files?: UploadFileInput[];
}

/**
 * What `POST /api/sdk/tickets` returns.
 *
 * The controller responds with a full `GetTicketDetailsResponse`, so the
 * server-decided fields — the allocated `xyneId`, the stage the ticket landed
 * on, and the status that stage implies — are all available without a second
 * read. Everything past `xyneId` is optional because it describes the row the
 * server built rather than the input, and a future controller change should
 * degrade to "absent" rather than to a type error.
 */
export interface CreateTicketResponse {
  id: string;
  conversationId: string;
  xyneId: string;
  title?: string;
  description?: string;
  /** The ticket's status. Named `status` on the wire, not `statusV2`. */
  status?: TicketStatusV2;
  priority?: TicketPriority;
  /** The stage the ticket landed on, decided by the board. */
  stageName?: string;
  projectId?: string;
  boardId?: string;
  assignedTo?: string | null;
  createdBy?: string;
  updatedBy?: string;
  eta?: number | null;
  closedAt?: number | null;
  closedBy?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: number;
  updatedAt?: number;
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

/**
 * Stage-approval request states. Mirrors `TicketStageRequestStatus`.
 *
 * This read `'PENDING' | 'APPROVED' | 'REJECTED'`, and every one of those three
 * words was wrong in a way the compiler could not see: `PENDING` is not a member,
 * so `upsertStageRequest` rejected it server-side, while `DRAFT` and `SUBMITTED`
 * were inexpressible — meaning the method could decide an approval request but
 * never raise one.
 */
export type StageRequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

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
  createdByUserId: string;
  title: string | null;
  startsAt: number | null;
  endsAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  participantCount: number | null;
  recurringSeriesId: string | null;
  /** JSON blob. The notes-canvas link lives here as `metadata.notesCanvasId`. */
  metadata?: unknown;
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
/** One email to mark read, for a bulk update. */
export interface EmailReadMarker {
  /** Id of the email. */
  id: string;
  /** Desk ticket the email belongs to. */
  ticketId: string;
}

/** Which composition an email came from. */
export type EmailType = 'DEFAULT' | 'REPLY' | 'REPLY_ALL' | 'COMPOSE';

/**
 * One email in a desk thread.
 *
 * `externalThreadId` and `externalMessageId` are the provider's own ids, which
 * is how a reply arriving later is threaded onto the same conversation.
 */
export interface Email {
  id: string;
  workspaceId: string;
  type: EmailType;
  subject: string;
  body: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  replyTo?: string[];
  /** Thread this email belongs to. */
  conversationId: string;
  channelId: string;
  /** The mail provider's thread id. */
  externalThreadId: string;
  /** The mail provider's message id. */
  externalMessageId: string;
  /** Set when the email was sent from Spaces rather than received. */
  sentByUserId?: string;
  /** RFC 5322 Message-ID header. */
  rfcMessageId?: string;
  /** Satisfaction rating, where the recipient left one. */
  rating?: number;
  clientVersionName?: string;
  clientVersionCode?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * A saved email draft.
 *
 * Recipients are stored serialised, so they come back as strings even though
 * the save methods take arrays.
 */
export interface EmailDraft {
  id: string;
  workspaceId: string;
  channelId: string;
  /** Set on a reply draft; absent on a compose draft. */
  conversationId?: string;
  userId?: string;
  draftContent: string;
  subject?: string;
  fromAddress?: string;
  /** Serialised recipient list. */
  toRecipients?: string;
  /** Serialised recipient list. */
  ccRecipients?: string;
  /** Serialised recipient list. */
  bccRecipients?: string;
  attachmentIds?: unknown;
  /** Where an automatically written draft stands. */
  autoDraftStatus?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
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

/** A label that can be applied to threads in a channel. */
export interface ConversationLabel {
  id: string;
  workspaceId: string;
  name: string;
  /** Display colour, where one is set. */
  color?: string;
  /** Channel the label is defined in. Labels are not shared across channels. */
  channelId: string;
  projectId?: string;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * One label applied to one thread.
 *
 * `labelName` is denormalised onto the mapping, so rendering a thread's labels
 * needs no second read.
 */
export interface ConversationLabelMapping {
  id: string;
  workspaceId: string;
  labelId: string;
  labelName: string;
  conversationId: string;
  channelId: string;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

// ----- Recap Types -----

/** Which kind of business entity a ticket field definition classifies. */
export type TicketFieldEntityType = 'MERCHANT' | 'GATEWAY';

/** How a stage's SLA clock is set when a ticket enters it. */
export type VisitSlaMode = 'STAGE_DEFAULT' | 'NONE' | 'FIXED_HOURS';

/** What happens to a stage's clock when a ticket returns to it. */
export type ReenterMode = 'RESET' | 'CONTINUE';

/** A board attached to a channel. One mapping per board a channel shows. */
export interface ChannelBoardMapping {
  id: string;
  workspaceId: string;
  channelId: string;
  boardId: string;
  /** Whether this is the board the channel opens on. */
  isDefault: boolean;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * A permitted move between two stages on a board.
 *
 * `fromStageId` is unset for the transition into the board's first stage.
 * Approval and SLA behaviour is configured per transition rather than per stage,
 * so the same target stage can behave differently depending on where a ticket
 * arrives from.
 */
export interface StageTransition {
  id: string;
  workspaceId: string;
  boardId: string;
  /** Unset for the entry transition. */
  fromStageId?: string;
  toStageId: string;
  /** Form that must be completed to make the move. */
  formId?: string;
  /** Unset counts as false. */
  requiresApproval?: boolean;
  /** Unset counts as false. */
  bypassApprovalForAutomation?: boolean;
  /** Unset counts as false. */
  requestApprovalOnEntry?: boolean;
  /** Unset counts as `STAGE_DEFAULT`. */
  visitSlaMode?: VisitSlaMode;
  /** Hours allowed in the target stage when `visitSlaMode` is `FIXED_HOURS`. */
  fixedEtaHours?: number;
  /** Unset counts as `RESET`. */
  onReenter?: ReenterMode;
  /** Epoch milliseconds. */
  createdAt?: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Who may approve one transition. */
export interface StageTransitionApproverInput {
  id: string;
  /** User or group id, depending on `approverType`. */
  approverId: string;
  /** Whether `approverId` names a user or a group. */
  approverType: string;
}

/**
 * One transition in a board's complete transition set.
 *
 * `boards.syncTransitions` replaces the whole set, so every transition to keep
 * must appear — including its `id`. Passing `null` for `fromStageId` marks the
 * entry transition.
 */
export interface StageTransitionInput {
  id: string;
  fromStageId?: string | null;
  toStageId: string;
  formId?: string | null;
  requiresApproval?: boolean;
  bypassApprovalForAutomation?: boolean;
  requestApprovalOnEntry?: boolean;
  visitSlaMode?: VisitSlaMode;
  fixedEtaHours?: number | null;
  onReenter?: ReenterMode;
  approvers?: StageTransitionApproverInput[];
}

/** Response and resolution targets for one priority on a board. */
export interface BoardSlaPolicy {
  id: string;
  workspaceId: string;
  boardId: string;
  /** The priority this policy applies to. */
  priority: TicketPriority;
  /** Hours allowed before a first response. */
  responseHours: number;
  /** Hours allowed before resolution. */
  resolutionHours: number;
  /** Whether the clock only runs during the working day below. */
  businessHoursOnly: boolean;
  /** IANA timezone the working day is measured in. */
  timezone: string;
  /** Hour the working day starts, 0-23. */
  workdayStart: number;
  /** Hour the working day ends, 0-23. */
  workdayEnd: number;
  isActive: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** How much of a group's capacity one board consumes, for assignment routing. */
export interface BoardComplexityScore {
  id: string;
  workspaceId: string;
  userGroupId: string;
  boardId: string;
  /** Relative cost of a ticket on this board. */
  weight: number;
  /** Whether `weight` is read as a percentage rather than a raw score. */
  usePercentage: boolean;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** What a ticket activity entry records. */
export type TicketActivityType =
  | 'TITLE' | 'DESCRIPTION' | 'STATUS' | 'ASSIGNED_TO' | 'TICKET_TYPE' | 'PRIORITY'
  | 'ETA' | 'STAGE_ETA' | 'METADATA' | 'CLOSED_AT' | 'CLOSED_BY' | 'REFERENCE_TICKET'
  | 'STAGE_NAME' | 'TAGS' | 'ENTITY' | 'SUBTICKET_CREATED' | 'SUBTICKET_LINKED'
  | 'SUBTICKET_UNLINKED' | 'BOARD' | 'PR' | 'USER_GROUP_ID' | 'PR_REVIEWER' | 'QA'
  | 'STAGE_CHANGE_REQUEST' | 'STAGE_CHANGE_APPROVED' | 'STAGE_CHANGE_REJECTED'
  | 'IS_ARCHIVED' | 'MERGED' | 'UNMERGED' | 'RCA_CREATED' | 'RCA_UPDATED'
  | 'EMAIL_SENT' | 'TICKET_CREATED' | 'CSAT_RECEIVED';

/** How two linked tickets relate. */
export type TicketReferenceRelation =
  | 'LINKED'
  | 'DUPLICATE_CONFIRMED'
  | 'DUPLICATE_POSSIBLE'
  | 'MERGED_INTO';

/** Where a desk ticket sits in one person's mailbox. */
export type MailboxState = 'INBOX' | 'ARCHIVED' | 'SPAM';

/**
 * One entry in a ticket's history.
 *
 * `value` carries the change itself, shaped by `activityType` — a status change
 * records the old and new status, a comment records its text.
 */
export interface TicketActivity {
  id: string;
  workspaceId: string;
  ticketId: string;
  /** Who made the change. */
  updatedBy: string;
  activityType: TicketActivityType;
  /** The change itself; its shape depends on `activityType`. */
  value: unknown;
  channelId?: string;
  /** Epoch milliseconds. */
  timestamp: number;
}

/** One person's assignment to a ticket. */
export interface TicketAssignment {
  id: string;
  workspaceId: string;
  ticketId: string;
  userId: string;
  /** What they are on the hook for, e.g. reviewer or QA. */
  userResponsibility?: string;
  roleId?: string;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** A requested export of a ticket listing. */
export interface TicketExport {
  id: string;
  workspaceId: string;
  requestedBy: string;
  status: string;
  /** Serialised JSON of the filters the export was run with. */
  filters: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** One person's mailbox row for a desk ticket. */
export interface TicketMailbox {
  id: string;
  workspaceId: string;
  ticketId: string;
  userId: string;
  channelId: string;
  state?: MailboxState;
  starred: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** A link between a parent ticket and one of its sub-tickets. */
export interface SubTicketMapping {
  id: string;
  workspaceId: string;
  ticketId: string;
  subTicketId: string;
}

/** A ticket attributed to the release that caused it. */
export interface ReleaseAttribution {
  id: string;
  workspaceId: string;
  ticketId: string;
  releaseId: string;
  releaseApplicationId?: string;
  /** The change that introduced the fault. */
  rootCauseTicketId?: string;
  confidence: AttributionConfidence;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Who may add people to a channel. */
export type ChannelAddUserPolicy = 'EVERYONE' | 'ADMINS_ONLY';

/** Whether a shared link is visible to the channel or only its owner. */
export type LinkVisibility = 'DEFAULT' | 'PERSONAL';

/** Rolled-up counters for one channel. */
export interface ChannelStats {
  workspaceId: string;
  channelId: string;
  /** Epoch milliseconds of the most recent message. */
  lastActivityAt: number;
  participantCount: number;
  addUserPolicy?: ChannelAddUserPolicy;
  /** Whether the last recap had anything to summarise. */
  lastRecapHadMessages?: boolean;
}

/** A link shared into a channel. */
export interface Link {
  id: string;
  workspaceId: string;
  channelId: string;
  url: string;
  title: string;
  description?: string;
  favicon?: string;
  visibility: LinkVisibility;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Where a scheduled message stands. */
export type DelayedMessageStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'CANCELLED';

/** A message queued to send later. */
export interface DelayedMessage {
  id: string;
  workspaceId: string;
  channelId: string;
  /** Thread it will be posted into, when it is a reply. */
  conversationId?: string;
  senderId: string;
  content: string;
  hasAttachment: boolean;
  /** When it is due to send, epoch milliseconds. */
  scheduledFor: number;
  status: DelayedMessageStatus;
  /** Why sending failed, when it did. */
  failureReason?: string;
  /** Epoch milliseconds, set once sent. */
  sentAt?: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** An unsent chat message kept per user and channel. */
export interface DraftMessage {
  id: string;
  workspaceId: string;
  channelId: string;
  /** Thread being replied to, when there is one. */
  conversationId?: string;
  /** Message being edited, when the draft is an edit. */
  messageId?: string;
  userId: string;
  content: string;
  hasAttachment: boolean;
  /** How the draft came to exist, e.g. written by hand or generated. */
  origin?: string;
  /** Serialised JSON, present only on generated drafts. */
  metadata?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Lifecycle state of a workspace or organisation. */
export type Status = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

/** What someone can do in a workspace. */
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST' | 'COMMUNITY_MEMBER';

/** What someone can do in an organisation. */
export type OrgRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'COMMUNITY_MEMBER' | 'GUEST';

/** What a resource grant allows. */
export type AccessType = 'ADMIN' | 'READ' | 'WRITE';

/** Fields a workspace update may change. */
export interface WorkspaceUpdate {
  name?: string;
  description?: string;
}

/** Fields a workspace-membership update may change. */
export interface WorkspaceUserUpdate {
  /** Only `ADMIN` and `MEMBER` can be set this way. */
  role?: 'ADMIN' | 'MEMBER';
}

/** One resource grant to create. */
export interface ResourceAccessGrant {
  id: string;
  userId: string;
  resourceId: string;
  accessType: AccessType;
}

/** One resource grant to change. */
export interface ResourceAccessUpdate {
  /** Id of the existing grant. */
  id: string;
  accessType: AccessType;
}

/** A workspace: the tenant everything else belongs to. */
export interface Workspace {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  status: Status;
  workspaceType?: string;
  /** How new people may join. */
  joinPolicy?: string;
  /** Channel members land in on first sign-in. */
  landingChannelId?: string;
  metadata?: unknown;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** An organisation, which owns one or more workspaces. */
export interface Organization {
  orgId: string;
  name: string;
  description?: string;
  status: Status;
  metadata?: unknown;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** An organisation's attachment to one workspace. */
export interface WorkspaceOrganization {
  id: string;
  orgId: string;
  workspaceId: string;
  role: WorkspaceRole;
  /** Epoch milliseconds, set once the organisation has left. */
  leftAt?: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * One person's membership of an organisation.
 *
 * `memberId` is the identity that follows a person across workspaces; a `User`
 * row is their presence inside one workspace.
 */
export interface OrgMember {
  memberId: string;
  orgId: string;
  email: string;
  role: OrgRole;
  /** Epoch milliseconds. */
  joinedAt: number;
  invitedBy?: string;
  /** Epoch milliseconds, set once the person has left. */
  leftAt?: number;
}

/** A named set of permissions that can be granted to people. */
export interface Role {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Something access can be granted over. */
export interface AccessResource {
  id: string;
  name: string;
  description?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * One grant of access to a resource.
 *
 * Exactly one of `userId` or `groupId` is set, naming who holds the grant.
 */
export interface ResourceAccess {
  id: string;
  workspaceId: string;
  resourceId: string;
  userId?: string;
  groupId?: string;
  accessType: AccessType;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** An outstanding invitation to join a workspace. */
export interface Invitation {
  id: string;
  workspaceId: string;
  orgId?: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  /** Epoch milliseconds. */
  invitedAt: number;
  /** Epoch milliseconds. */
  expiredAt?: number;
  /** Epoch milliseconds, set once the invitation is taken up. */
  acceptedAt?: number;
  /** External invitation reference, where one exists. */
  invitationId?: string;
  /** Thing the invitee is being invited to, when narrower than the workspace. */
  entityId?: string;
  entityType?: string;
  channelId?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** An app published to the marketplace. */
export interface App {
  id: string;
  workspaceId: string;
  orgId: string;
  name: string;
  description?: string;
  /** What the app is permitted to reach. */
  scope: string;
  version: number;
  webhookUrl?: string;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** One installation of an app into a workspace. */
export interface InstalledApp {
  id: string;
  workspaceId: string;
  appId: string;
  /** Who installed it. */
  userId: string;
  webhookUrl?: string;
  /** Secret used to verify webhook deliveries. */
  signingSecret?: string;
  version?: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Whether a call carries audio, video, or is a headless recording. */
export type CallType = 'AUDIO' | 'VIDEO' | 'HEADLESS';

/** Where a recurring call series stands. */
export type RecurringCallSeriesStatus = 'ACTIVE' | 'ENDED' | 'CANCELLED';

/**
 * A template shaping how a call's notes are summarised.
 *
 * `sections` describes the summary's structure and `systemPrompt` the
 * instruction the model is given.
 */
export interface SummaryTemplate {
  id: string;
  workspaceId: string;
  name: string;
  /** Structure of the generated summary. */
  sections: unknown;
  systemPrompt: string;
  /** Prompt that decides whether the template fires on its own. */
  autoTriggerPrompt?: string;
  /** Where the summary is posted by default. */
  defaultOutlet: string;
  visibility: string;
  version: number;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/**
 * A repeating call and the rule that schedules it.
 *
 * `recurrenceRule` is an RFC 5545 RRULE; `startTime` and `endTime` are
 * wall-clock times in `timezone`, not timestamps.
 */
export interface RecurringCallSeries {
  id: string;
  workspaceId: string;
  title: string;
  description?: string;
  organizerId: string;
  channelId: string;
  /** RFC 5545 RRULE. */
  recurrenceRule: string;
  /** IANA timezone the wall-clock times are read in. */
  timezone: string;
  /** Wall-clock start, e.g. `09:30`. */
  startTime: string;
  /** Wall-clock end, e.g. `10:00`. */
  endTime: string;
  status: RecurringCallSeriesStatus;
  /** Epoch milliseconds. */
  startsOn: number;
  /** Epoch milliseconds. */
  endsOn?: number;
  /** Channel that receives schedule-change notices. */
  callUpdatesChannel?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Which vocabulary a lookup value belongs to. */
export type LookupType =
  | 'TICKET_TYPE'
  | 'COE_ACTION_TYPE'
  | 'COE_ACTION_TYPE_RELIABILITY_CHANGE'
  | 'COE_ACTION_TYPE_RELIABILITY_CAPACITY'
  | 'COE_ACTION_TYPE_RELIABILITY_FAULT'
  | 'COE_ACTION_TYPE_PERF'
  | 'COE_ACTION_TYPE_UIUX'
  | 'IMPACT_TYPE'
  | 'BUG_TYPE'
  | 'BUG_CATEGORY_TYPE'
  | 'BUG_ISSUE_TYPE'
  | 'BUG_ISSUE_CATEGORY_CAPACITY'
  | 'BUG_ISSUE_CATEGORY_CHANGE'
  | 'BUG_ISSUE_CATEGORY_FAULT'
  | 'BUG_RESOLUTION_CAPACITY'
  | 'BUG_RESOLUTION_CHANGE'
  | 'BUG_RESOLUTION_FAULT'
  | 'QUICK_FIX_OPTION';

/** A workspace-uploaded emoji, usable anywhere a built-in emoji is. */
export interface CustomEmoji {
  id: string;
  workspaceId: string;
  /** Short name, without colons. */
  name: string;
  url: string;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** A source repository registered for SDLC work. */
export interface Repo {
  id: string;
  workspaceId: string;
  name: string;
  /** SSH or HTTPS clone URL. */
  url: string;
  /** Normalised form of `url`, for matching. */
  canonicalUrl?: string;
  /** Branches new work is cut from. */
  baseBranch: string[];
  /** Prefix given to branches created here, e.g. `feature`. */
  prefix: string;
  projectId?: string;
  channelId?: string;
  /** Run that provisioned the repository's SDLC setup. */
  sdlcSetupExecutionId?: string;
  /** What the connected credential is allowed to do. */
  accessCapabilities?: unknown;
  createdBy: string;
}

/** A unit of SDLC work, spanning the branches and tickets that deliver it. */
export interface SdlcTrack {
  id: string;
  workspaceId: string;
  repoId?: string;
  name: string;
  description?: string;
  status: string;
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** One option in a configurable vocabulary, such as a bug type. */
export interface LookupValue {
  id: string;
  type: LookupType;
  value: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** A merchant, addressed by its merchant id. */
export interface Merchant {
  id: string;
  /** The merchant id used across tickets and filters. */
  mid: string;
}

/** A tag applied to one ticket. */
export interface TicketTag {
  id: string;
  workspaceId: string;
  ticketId: string;
  name: string;
}

/** A routing rule sending one category of desk traffic to a group. */
export interface ClassificationMapping {
  id: string;
  workspaceId: string;
  channelId: string;
  category: string;
  subCategory?: string;
  /** Group the matching traffic is routed to. */
  userGroupId: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** How serious an incident is. */
export type Severity = 'SEV_1' | 'SEV_2' | 'SEV_3';

/** How certain a release attribution is. */
export type AttributionConfidence = 'LOW' | 'MEDIUM' | 'HIGH';

/** Where a corrective action stands. */
export type CoeStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';

/** Where a root-cause analysis stands. */
export type RcaStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'CLOSED';

/** What kind of thing a release event records. */
export type ReleaseEventType = 'RELEASE' | 'TICKET' | 'SUBTICKET' | 'TESTING' | 'SYSTEM' | 'CANVAS';

/** A root-cause analysis written against a ticket. */
export interface Rca {
  id: string;
  workspaceId: string;
  title: string;
  /** Ticket the analysis is about. */
  ticketId: string;
  /** User accountable for completing it. */
  ownerId: string;
  summary?: string;
  rootCause?: string;
  severity: Severity;
  status: RcaStatus;
  bugTypeId: string;
  categoryTypeId: string;
  issueCategoryId?: string;
  /** When the issue began, epoch milliseconds. */
  issueStartAt?: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * A dev ticket included in one application's release, with its test outcome.
 *
 * `ticketId` is the underlying ticket's id; read the ticket itself for its
 * title and stage.
 */
export interface ApplicationReleaseTicket {
  id: string;
  workspaceId: string;
  releaseId: string;
  applicationReleaseId: string;
  ticketId: string;
  /** Who signed the ticket off, once it has been tested. */
  testedBy?: string;
  /** Epoch milliseconds. */
  testedAt?: number;
  /** Why testing failed, when it did. */
  failureReason?: string;
  /** Whether the ticket entered this release as a hotfix. */
  isHotfix?: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt?: number;
}

/** One code change attributed to a release, from the repository scan. */
export interface ReleaseChange {
  id: string;
  workspaceId: string;
  applicationId: string;
  /** What kind of change this is, e.g. a migration or a config edit. */
  changeType: string;
  releaseId?: string;
  applicationReleaseId?: string;
  /** Key of the dev ticket the change belongs to. */
  devTicketXyneId?: string;
  commitId?: string;
  filePath?: string;
  /** Epoch milliseconds. */
  createdAt?: number;
}

/** One entry in a release's timeline. */
export interface ReleaseEvent {
  id: string;
  workspaceId: string;
  releaseId: string;
  /** The per-application release this event belongs to, where it has one. */
  applicationReleaseId?: string;
  eventType: ReleaseEventType;
  eventName: string;
  /** Human-readable description of what happened. */
  message: string;
  /** Who caused it, for user-driven events. */
  userId?: string;
  userName?: string;
  channelId: string;
  conversationId: string;
  /** Event-specific detail. */
  payload?: unknown;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** How much a channel or the workspace notifies. */
export type NotificationLevel = 'ALL' | 'MENTIONS_ONLY' | 'THREADS_ONLY' | 'NONE';

/** Which channels a sidebar group shows. */
export type ChannelFilterMode = 'ACTIVE' | 'UNREADS' | 'MENTIONS' | 'ALL';

/**
 * The caller's own settings row.
 *
 * One row per user. Every `preferences.set*` method writes part of it, and
 * `preferences.get` reads the whole thing back.
 */
export interface UserPreferences {
  id: string;
  workspaceId: string;
  userId: string;
  /** Standing instructions applied to Ask AI. */
  askai_custom_instruction?: string;
  channelSortOrder: ChannelSortOrder;
  channelFilterMode?: ChannelFilterMode;
  starredFilterMode?: ChannelFilterMode;
  starredSortOrder?: ChannelSortOrder;
  dmFilterMode?: ChannelFilterMode;
  dmSortOrder?: ChannelSortOrder;
  /** True: Enter sends. False: Shift+Enter sends. */
  enterSendsMessage: boolean;
  /** Whether `@channel` and `@here` are allowed in thread replies. */
  allowThreadBroadcastMentions: boolean;
  globalDesktopNotificationLevel?: NotificationLevel;
  globalMobileNotificationLevel?: NotificationLevel;
  threadReplyNotificationsEnabled: boolean;
  channelWideMentionsEnabled: boolean;
  /** Stringified JSON array; read it with `JSON.parse`. */
  notificationKeywords?: string;
  showThreadTags: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Where a form can be bound. */
export type FormContextType = 'BOARD' | 'RELEASE_CHANGE' | 'STAGE';

/** What kind of record a form's values attach to. */
export type FormEntityType = 'TICKET' | 'SUB_TICKET';

/**
 * A binding of one form to one context, so the form applies there.
 *
 * A board can bind a different form for tickets than for sub-tickets, which is
 * why `contextId` alone does not identify a mapping.
 */
export interface FormContextMapping {
  id: string;
  workspaceId: string;
  formId: string;
  /** Id of the board, stage or release change the form is bound to. */
  contextId: string;
  contextType: FormContextType;
  entityType: FormEntityType;
}

/** What a bookmark points at. */
export type BookmarkEntityType = 'MESSAGE' | 'CONVERSATION' | 'TICKET' | 'CANVAS';

/** A saved reference to something, kept per user. */
export interface Bookmark {
  id: string;
  workspaceId: string;
  userId: string;
  /** Id of the bookmarked thing. */
  entityId: string;
  entityType: BookmarkEntityType;
  /** Whether the user has ticked it off. */
  isCompleted: boolean;
  isDeleted: boolean;
  metadata?: unknown;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/**
 * An automation run, or a scheduled one waiting to start.
 *
 * `eventType` is what triggers it and `status` is where the run stands.
 * `configuration` and `metadata` carry the automation's own JSON, as strings.
 */
export interface Workflow {
  id: string;
  workspaceId: string;
  /** Ticket the run is about, when it is scoped to one. */
  ticketId?: string;
  context?: string;
  status: string;
  workflowName?: string;
  workflowType?: string;
  /** What triggers the run. */
  eventType: string;
  /** Serialised JSON. */
  metadata?: string;
  /** Serialised JSON. */
  configuration?: string;
  /** Recurring series this run belongs to. */
  automationSeriesId?: string;
  /** Epoch milliseconds, when the run is scheduled rather than immediate. */
  scheduledAt?: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** What a saved view is scoped to. */
export type SavedConfigContextType = 'BOARD';

/** Who can see a saved view. */
export type SavedConfigVisibility = 'PRIVATE' | 'PUBLIC';

/** A named, reusable set of filters over a board. */
export interface SavedView {
  id: string;
  workspaceId: string;
  /** User who created it. */
  userId: string;
  name: string;
  contextType: SavedConfigContextType;
  /** Id of the thing it is scoped to, e.g. a board. */
  contextId: string;
  visibility: SavedConfigVisibility;
  isStarred?: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** What a collection grant allows. */
export type CollectionRole = 'OWNER' | 'EDITOR' | 'VIEWER';

/**
 * One grant of access to a collection.
 *
 * Exactly one of `userId`, `userGroupId` or `channelId` is set, naming who the
 * grant is for.
 */
export interface CollectionPermission {
  id: string;
  workspaceId: string;
  collectionId: string;
  userId?: string;
  userGroupId?: string;
  channelId?: string;
  role: CollectionRole;
  /** Whether the grantee may grant access to others. */
  canShare: boolean;
  grantedBy?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** How often an on-call rotation advances. */
export type RotationInterval = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';

/** A member's role within a user group. */
export type UserResponsibility = 'MANAGER' | 'TEAM_LEAD' | 'MEMBER' | 'PR_REVIEWER' | 'QA';

/**
 * A named group of people that work can be assigned to.
 *
 * A group can rotate on-call duty automatically: `autoRotationEnabled` turns
 * that on, and `rotationInterval` and `rotationStartDate` say when it advances.
 */
export interface UserGroup {
  id: string;
  workspaceId: string;
  name: string;
  /** Short handle, where the group has one. */
  alias?: string;
  description?: string;
  isActive: boolean;
  metadata?: unknown;
  autoRotationEnabled: boolean;
  rotationInterval?: RotationInterval;
  /** Epoch milliseconds. */
  rotationStartDate?: number;
  /** Whether work moves off a member who becomes unavailable. */
  reassignOnUnavailable?: boolean;
  /** Cap on concurrent assignments per member. */
  maxWorkload?: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  createdBy?: string;
}

/** One person's membership of a user group. */
export interface UserGroupMember {
  id: string;
  workspaceId: string;
  userId: string;
  userGroupId: string;
  responsibility?: UserResponsibility;
  roleId?: string;
  /** Position in the on-call rotation. */
  onCallSetNumber?: number;
  /** Every rotation set this member belongs to. */
  onCallSetNumbers: number[];
  /** Rotations to skip before this member's first turn. */
  startOffset?: number;
  isNotified: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Whether a group member is on call and taking new work. */
export interface UserAssignmentState {
  id: string;
  workspaceId: string;
  userId: string;
  userGroupId: string;
  onCall: boolean;
  isActiveForAssignment: boolean;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  createdBy: string;
}

/** How much work one group member currently holds on a board. */
export interface UserWorkloadMapping {
  id: string;
  workspaceId: string;
  userId: string;
  userGroupId: string;
  boardId: string;
  /** Assignments still open. */
  activeTasks: number;
  /** Assignments ever made. */
  totalTasks: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  createdBy: string;
}

/** A group member's declared expertise on a board, used when routing work. */
export interface UserExpertiseMapping {
  id: string;
  workspaceId: string;
  userId: string;
  userGroupId: string;
  boardId: string;
  hasExpertise: boolean;
  /** Share of this board's work to route here, 0-100. */
  percentage: number;
  /** Cap on concurrent tickets from this board. */
  maxTickets: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  createdBy: string;
}

/** A free-form tag defined on a project and applied to its tickets. */
export interface ProjectTag {
  id: string;
  workspaceId: string;
  /** The project that owns the tag. Tags are not shared across projects. */
  projectId: string;
  name: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/**
 * A custom-field definition available to a project's tickets.
 *
 * `entityType` says what kind of thing the field names, and `entityName` is the
 * value itself — a merchant or gateway a ticket is attributed to.
 */
export interface TicketFieldDefinition {
  id: string;
  workspaceId: string;
  ticketId: string;
  entityType: TicketFieldEntityType;
  entityName: string;
}

/**
 * A deployable application registered against a project, for release tracking.
 *
 * `regex` matches the version tags this application publishes; `envPaths` and
 * `migrationPaths` are repository paths the release tooling watches.
 */
export interface Application {
  id: string;
  workspaceId: string;
  name: string;
  projectId: string;
  boardId: string;
  mainReleaseBoardId?: string;
  channelId?: string;
  regex: string;
  repoUrl: string;
  deployedCommit?: string;
  deployedVersion?: string;
  /** Epoch milliseconds. */
  lastDeployedAt?: number;
  ownerTeam: string;
  envPaths: string[];
  migrationPaths: string[];
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt?: number;
}

/** What a nudge is suggesting. */
export type NudgeKind =
  | 'CREATE_TICKET_FROM_MESSAGE'
  | 'FIND_RELATED_TICKET_FROM_MESSAGE'
  | 'FIND_RELATED_MESSAGE_FROM_MESSAGE'
  | 'LINK_PASTE_TO_SURFACE'
  | 'FORWARD_MESSAGE_LINK'
  | 'DELETE_MESSAGE_CLEANUP'
  | 'SCHEDULE_CALL_FROM_THREAD';

/** Where a nudge stands: still offered, dismissed, or taken up. */
export type NudgeState = 'ACTIVE' | 'DISMISSED' | 'ACTED_ON';

/**
 * A suggested next step surfaced against a message, ticket or thread.
 *
 * `sourceId` is the thing the nudge is about, and `actions` carries the
 * kind-specific payload the UI needs to offer it.
 */
export interface Nudge {
  id: string;
  workspaceId: string;
  nudgeKind: NudgeKind;
  /** Id of the entity this nudge is attached to. */
  sourceId: string;
  title: string;
  description: string;
  priority?: string;
  actions?: unknown;
  state: NudgeState;
  /** User id when the nudge is shown to one person only. */
  visibleTo?: string;
  /** Set when the nudge is one of several rolled into an aggregate count. */
  surfaceNudgeCountId?: string;
  projectId?: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
}

/** Placement of a saved query on a dashboard, in display order. */
export interface DashboardQueryMapping {
  id: string;
  workspaceId: string;
  dashboardId: string;
  queryId: string;
  /** Position on the dashboard, ascending. */
  sequence: number;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  /** The saved query itself, when the dashboard was read by id. */
  query?: unknown; // relation
}

/** One tile's new position, for a layout change. */
export interface DashboardLayoutUpdate {
  /** Placement id, not the query id. */
  id: string;
  /** New position on the dashboard, ascending. */
  sequence: number;
}

/** A dashboard: a named collection of saved queries laid out as tiles. */
export interface Dashboard {
  id: string;
  workspaceId: string;
  name: string;
  description?: string;
  /** User id of the creator. */
  createdBy: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  updatedAt: number;
  /** Tile placements, present when the dashboard was read by id. */
  queryMappings?: DashboardQueryMapping[]; // relation
}

/** A generated summary of a channel's or project's activity for one day. */
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

/**
 * The ids and context a hit carries, so the next call can act on it.
 *
 * Populated per result type — a message hit carries `conversationId` and
 * `messageId`, a ticket hit carries `ticketId` and `xyneId`, an attachment hit
 * carries `attachmentId` and its file metadata.
 */
export interface SearchContext {
  channelId?: string;
  channelTitle?: string;
  scopeType?: string;
  conversationId?: string;
  messageId?: string;
  replyCount?: number;
  isRootMessage?: boolean;
  msgType?: string;
  threadSenders?: string[];
  attachmentIds?: string[];
  senderId?: string;
  senderName?: string;
  senderEmail?: string;
  userId?: string;
  email?: string;
  status?: string;
  memberCount?: number;
  closedBy?: string;
  closedByName?: string;
  boardName?: string;
  projectName?: string;
  ticketId?: string;
  ticketStatus?: string;
  boardId?: string;
  createdBy?: string;
  creatorName?: string;
  assignedTo?: string;
  assigneeName?: string;
  attachmentId?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  internalUrl?: string;
  originalUrl?: string;
  xyneId?: string;
  subApp?: string;
  callType?: string;
  mailId?: string;
  recipientCount?: number;
  formFieldMatches?: Array<{ fieldId: string; fieldName?: string; fieldValue: string }>;
  priority?: string;
  stageName?: string;
  projectId?: string;
  /** Epoch milliseconds. */
  createdAtTimestamp?: number;
  ticketType?: string;
  userGroupId?: string;
  tags?: string[];
  callId?: string;
  externalId?: string;
  userIds?: string[];
  participantResponses?: string[];
  participantNames?: string[];
  participantEmails?: string[];
  title?: string;
  createdByUserId?: string;
  roomLink?: string;
  callOrigin?: string;
  /** Epoch milliseconds. */
  startsAt?: number;
  /** Epoch milliseconds. */
  endsAt?: number;
  /** Epoch milliseconds. */
  startedAt?: number;
  /** Epoch milliseconds. */
  endedAt?: number;
  recurringSeriesId?: string;
  hasTranscript?: boolean;
  collectionId?: string;
  docId?: string;
  folderId?: string;
}

/** One search hit. */
export interface SearchResult {
  id: string;
  /**
   * What this hit is. **Singular**, and a different vocabulary from
   * {@link SearchType}, which is the request-side filter — `conversation` here
   * corresponds to `messages` there, `attachment` to `files`. Feeding a value
   * from here straight back into `SearchOptions.type` fails with
   * `validation_failed`.
   */
  type: 'user' | 'conversation' | 'channel' | 'ticket' | 'attachment' | 'collection' | 'call';
  /** Channel name for a message hit, document title for everything else. */
  title: string;
  subtitle: string;
  /** The matching text, for display. */
  context?: string;
  relevanceScore: number;
  avatar?: string;
  metadata: {
    /** ISO 8601. */
    timestamp: string;
    channelName?: string;
    status?: string;
    /** Human-readable, e.g. `1.2 MB`. */
    fileSize?: string;
  };
  /** The ids that let a follow-up call act on this hit. */
  searchContext?: SearchContext;
}

/**
 * Search indexes that {@link SearchResponse} draws from, as named by
 * `search.getSchema`. A different vocabulary from `SearchOptions.type`, which
 * names result kinds rather than indexes.
 */
export type SearchSchemaName =
  | 'chat_message'
  | 'chat_attachment'
  | 'chat_container'
  | 'ticket'
  | 'user'
  | 'file'
  | 'sam_transcript'
  | 'mail'
  | 'mail_attachment'
  | 'project'
  | 'memory'
  | 'call';

/** One bucket of grouped search results. */
export interface SearchGroup {
  /** What the bucket is keyed on, e.g. a channel name. */
  groupValue?: string;
  /** Number of matches in this bucket. */
  count?: number;
  results?: SearchResult[];
}

/**
 * What a search returns.
 *
 * Results arrive grouped by default. Pass `groupBy: ''` for one flat ranked
 * list, in which case `results` is populated and `groups` is not.
 */
export interface SearchResponse {
  /** True when the response is bucketed into {@link SearchGroup}s. */
  grouped?: boolean;
  /** Flat ranked results. Present when the response is not grouped. */
  results?: SearchResult[];
  /** Buckets. Present when the response is grouped. */
  groups?: SearchGroup[];
  /** Total matches across every bucket, before paging. */
  totalCount?: number;
  offset?: number;
  limit?: number;
}

/**
 * Result types `SearchOptions.type` accepts. Plural — see {@link SearchResult.type}.
 *
 * Mirrors `TYPES` in the contract's `searchQuerySchema`, which the server
 * validates strictly, and `npm run contract-check` fails if the two drift.
 */
export type SearchType =
  | 'messages'
  | 'attachments'
  | 'calls'
  | 'channels'
  | 'tickets'
  | 'users'
  | 'files'
  | 'canvas'
  | 'transcript'
  | 'rca'
  | 'people'
  | 'emails';

/** Apps `SearchOptions.apps` accepts. Mirrors `APPS` in the contract. */
export type SearchApp =
  | 'chat'
  | 'ticket'
  | 'user'
  | 'file'
  | 'collection'
  | 'mail'
  | 'xyneapp'
  | 'call';

/**
 * Search parameters.
 *
 * Names match the server's query contract exactly. Note `orderBy` — an earlier
 * version of this SDK sent `sortBy`/`sortOrder`, which exist in neither search
 * validator, so sorting silently did nothing.
 *
 * `type` and `apps` are literal unions rather than `string`, because the server
 * rejects an unrecognised value outright instead of ignoring it. While they were
 * typed `string | string[]`, `type: 'message'` — the singular form that
 * `SearchResult.type` hands back — compiled cleanly and failed at runtime.
 */
export interface SearchOptions {
  /** Free text. Omit to search by filters alone. */
  q?: string;
  /** Restrict to result types, e.g. `'messages'` or `['messages','tickets']`. */
  type?: SearchType | SearchType[];
  /** Apps to search: `chat`, `ticket`, `user`, `file`. */
  apps?: SearchApp | SearchApp[];
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

/**
 * The identity a credential acts as, from `sdk.users.me()`.
 *
 * `role` and `orgRole` are read from the database on each call rather than
 * carried in the credential, so they always reflect current permissions.
 */
export interface CurrentUser {
  /** The acting user's id, as used by every `userId` argument in the API. */
  id: string;
  email: string;
  name: string;
  displayName: string | null;
  workspaceId: string;
  orgId: string;
  /** Org membership id, required by some operations such as stage approvals. */
  memberId: string;
  role: string;
  orgRole: string;
  /** When the key stops working, ISO 8601. Rotate before this. */
  keyExpiresAt: string;
}

/** A remote agent that can be dispatched to. */
export interface ClawAgent {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  color: string;
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
  /** Reuse an existing conversation to continue a thread. */
  conversationId?: string;
  /** Post the agent's reply into this Spaces channel or DM. */
  channelId?: string;
  /** Extra context to prepend to the task. */
  context?: string;
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
