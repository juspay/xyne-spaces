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

// ----- Channel Types -----

export interface Channel {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  channelType: 'channel' | 'dm' | 'group_dm' | 'email';
  isPrivate: boolean;
  isArchived: boolean;
  createdByUserId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelParticipant {
  id: string;
  channelId: string;
  userId: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

export interface ChannelUserStatus {
  channelId: string;
  userId: string;
  lastReadMessageId: string | null;
  lastReadAt: number | null;
  isMuted: boolean;
  isPinned: boolean;
  isDeleted: boolean;
}

// ----- Message Types -----

export interface Message {
  id: string;
  conversationId: string;
  channelId: string;
  senderId: string;
  content: string;
  contentType: 'text' | 'system' | 'ai';
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: number;
  updatedAt: number;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  resourceId: string;
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

export interface Conversation {
  id: string;
  channelId: string;
  parentMessageId: string | null;
  initialMessageId: string | null;
  createdAt: number;
  updatedAt: number;
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
