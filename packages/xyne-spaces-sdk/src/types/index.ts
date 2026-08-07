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

export interface Ticket {
  id: string;
  workspaceId: string;
  boardId: string;
  stageId: string;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  status: string;
  assigneeId: string | null;
  reporterId: string | null;
  dueDate: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Board {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Stage {
  id: string;
  boardId: string;
  name: string;
  position: number;
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
