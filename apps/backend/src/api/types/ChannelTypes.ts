import { ChannelScopeType, ChannelVisibility } from '@xyne/shared';
// Channel API Response Types
// These types define the structure of API responses from the channel controller


// Base user info interface for API responses
export interface ApiUserInfo {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

// Channel participant info for API responses
export interface ApiChannelParticipant {
  userId: string;
  role: 'ADMIN' | 'MEMBER';
  joinedAt: string;
  user: ApiUserInfo;
}

// Conversation info for API responses
export interface ApiConversation {
  conversationId: string;
  channelId: string;
  createdBy: string;
  replyCount: number;
  pinned: boolean;
  lastActivityAt?: Date;
  createdAt: Date;
}

// Base channel structure for API responses
export interface ApiChannel {
  id: string;
  name: string;
  scopeType: ChannelScopeType;
  description?: string | null;
  visibility?: ChannelVisibility | null;
  projectId: string;
  createdBy: string;
  conversationCount: number;
  participantCount: number;
  unreadCount: number;
  lastActivityAt?: Date | null;
  createdAt: Date;
  userRole?: 'ADMIN' | 'MEMBER';
  isMember?: boolean;
  partner?: ApiUserInfo; // For DM channels
}

// API Response Types for each endpoint

// POST /channels
export interface CreateChannelResponse {
  channelId: string; // Channel ID (for frontend compatibility)
  id: string;
  name: string;
  scopeType: ChannelScopeType;
  description?: string | null;
  visibility?: ChannelVisibility | null;
  projectId: string;
  createdAt: Date;
  participantResults?: {
    total: number;
    successful: number;
    failed: number;
    details: Array<{
      userId: string;
      success: boolean;
      error?: string;
    }>;
  };
}

// POST /channels/check-duplicate
export interface CheckDuplicateChannelResponse {
  isDuplicate: boolean;
  name: string;
  /** Echoed back when provided by the client. The check itself is workspace-scoped. */
  projectId?: string;
}

// GET /channels
export interface GetChannelsResponse {
  channels: ApiChannel[];
  total: number;
}

// GET /channels/:channelId
export interface GetChannelDetailsResponse {
  id: string;
  name: string;
  scopeType: ChannelScopeType;
  description?: string | null;
  visibility?: ChannelVisibility | null;
  projectId: string;
  lastActivityAt?: Date | null;
  createdAt: Date;
  conversationCount: number;
  participantCount: number;
  conversations: ApiConversation[]; // First 10 conversations
}

// POST /channels/:channelId/join
export interface JoinChannelResponse {
  message: string;
  id: string;
}

// DELETE /channels/:channelId/leave
export interface LeaveChannelResponse {
  message: string;
  id: string;
}

// POST /channels/:channelId/participants
export interface AddParticipantsResponse {
  message: string;
  id: string;
  results: Array<{
    userId: string;
    success: boolean;
    error?: string;
    alreadyMember?: boolean;
  }>;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

// GET /channels/:channelId/participants
export interface GetChannelParticipantsResponse {
  id: string;
  participants: ApiChannelParticipant[];
  participantCount: number;
}

// POST /channels/:channelId/mark-viewed
export interface MarkChannelViewedResponse {
  success: boolean;
  id: string;
  markedAt: string;
}

// GET /users/me/dms
export interface GetUserDMsResponse {
  channels: Array<ApiChannel & {
    partner?: ApiUserInfo;
  }>;
  total: number;
}

// POST /users/me/dms
export interface CreateNewDMResponse {
    message: string;
    id: string;
    name: string;
    scopeType: string;
    description?: string;
    visibility: string;
    projectId: string;
    conversationCount: number;
    participantCount: number;
    unreadCount: number;
    lastActivityAt?: string;
    createdAt: string;
    participants?: Array<{
      userId: string;
      role: string;
      user: {
        id: string;
        name: string;
        email: string;
        picture?: string;
      };
    }>;
    targetUser?: {
      id: string;
      name: string;
      email: string;
      picture?: string;
    };
    isExisting: boolean;
}

// GET /channels/search (unified user/group search) - filtered for users only
export interface SearchUsersResponse {
  users: ApiUserInfo[];
  total: number;
  query: string;
  limit: number;
}

