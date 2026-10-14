// Shared global search types used by Dashboard and Lotus.

// Backend entity types (plural)
export const SearchableEntityType = {
  USERS: 'users',
  MESSAGES: 'messages',
  CHANNELS: 'channels',
  TICKETS: 'tickets',
  ATTACHMENTS: 'attachments',
} as const;

export type SearchableEntityType = (typeof SearchableEntityType)[keyof typeof SearchableEntityType];

// Frontend display entity types
export const DisplayEntityType = {
  USER: 'user',
  CHANNEL: 'channel',
  CONVERSATION: 'conversation',
  TICKET: 'ticket',
  ATTACHMENT: 'attachment',
} as const;

export type DisplayEntityType = (typeof DisplayEntityType)[keyof typeof DisplayEntityType];

export interface GlobalSearchFilters {
  query: string;
  entityTypes?: SearchableEntityType[];
  orgName?: string;
  channelIds?: string[];
  userIds?: string[];
  dateRange?: {
    from?: string;
    to?: string;
  };
  page?: number;
  limit?: number;
  searchType?: 'trigram' | 'fts' | 'both';
  sort?: 'relevance' | 'newest' | 'oldest';
}

export interface SearchContext {
  channelId?: string;
  channelTitle?: string;
  scopeType?: string;
  conversationId?: string;
  messageId?: string;
  /** Call transcript system message id (CallLogItem metadata.systemMessageId). */
  systemMessageId?: string;
  replyCount?: number;
  orgName?: string;
  senderName?: string;
  senderId?: string;
  ticketId?: string;
  xyneId?: string;
  ticketStatus?: string;
  /** Postgres email id for desk mail results (scroll-to target). */
  mailId?: string;
  /** Total to+cc+bcc recipients for desk mail results. */
  recipientCount?: number;
  attachmentId?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  internalUrl?: string;
  originalUrl?: string;
  subApp?: string;
  /** Epoch ms from Vespa — preferred for local date/time display. */
  createdAtTimestamp?: number;
  // Call-specific fields returned by Vespa so call search can render without Zero hydration
  callId?: string;
  externalId?: string;
  callType?: string;
  title?: string;
  createdByUserId?: string;
  roomLink?: string;
  callOrigin?: string;
  status?: string;
  startsAt?: number;
  endsAt?: number;
  startedAt?: number;
  endedAt?: number;
  recurringSeriesId?: string;
  hasTranscript?: boolean;
  userIds?: string[];
  participantResponses?: string[];
  participantNames?: string[];
  participantEmails?: string[];
}

export interface SearchResult {
  id: string;
  type: SearchableEntityType;
  title: string;
  subtitle?: string;
  content: string;
  relevanceScore: number;
  createdAt: string;
  avatar?: string;
  context?: SearchContext;
}

export interface PaginatedSearchResults {
  results: SearchResult[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  aggregations: {
    userCount: number;
    messageCount: number;
    channelCount: number;
    ticketCount: number;
    attachmentCount: number;
  };
  meta: {
    query: string;
    searchTime: string;
    searchType: string;
  };
}

export interface DisplaySearchResult {
  type: DisplayEntityType;
  id: string;
  title: string;
  subtitle: string;
  context?: string;
  avatar?: string;
  /**
   * Raw ISO timestamp, when the backend supplies one. Preferred over
   * `metadata.timestamp` for navigation cursors because it needs no timezone
   * correction — see resolveSearchResultCreatedAtMs.
   */
  createdAt?: string;
  metadata: {
    channelName?: string;
    timestamp?: string;
    status?: string;
    fileSize?: string;
    unreadCount?: number;
  };
  searchContext?: SearchContext;
  relevanceScore: number;
  debugInfo?: {
    matchfeatures?: Record<string, string | number>;
    rankfeatures?: Record<string, string | number>;
  };
}

export interface SearchApiResponse {
  success: boolean;
  data?: PaginatedSearchResults;
  error?: string;
}

export interface VespaSearchFilters {
  query: string;
  type?: string;
  from?: string;
  in?: string;
  /** Participant filter for call search (maps to `withUser` query param). */
  with?: string;
  offset?: number;
  limit?: number;
  apps?: string;
  rankProfile?: string;
  includeDebugInfo?: boolean;
  projectId?: string;
  status?: string;
  ticketId?: string;
  searchId?: string;
  priority?: string;
  board?: string;
  tags?: string;
  before?: string;
  after?: string;
  on?: string;
  range?: string;
  stage?: string;
  assignee?: string;
  subApp?: string;
  callType?: string;
  filterOnly?: boolean;
  /** Vespa presentation.summary profile (dashboard desk search sends `lean`). */
  presentationSummary?: string;
  /** When false with `in:`, don't further constrain to membership-only channels. */
  onlyMyChannels?: boolean;
}

export interface VespaSearchGroup {
  groupBy: string;
  groupValue: string;
  count: number;
  results: DisplaySearchResult[];
}

export interface VespaSearchResponseData {
  grouped?: boolean;
  groups?: VespaSearchGroup[];
  results?: DisplaySearchResult[];
  totalCount: number;
  offset: number;
  limit: number;
}

export interface VespaSearchResponse {
  success: boolean;
  data?: VespaSearchResponseData;
  error?: string;
}

export interface VespaSearchResultsPage {
  results: DisplaySearchResult[];
  totalCount: number;
  offset: number;
  limit: number;
}

export interface PartitionedDisplaySearchResults {
  users: DisplaySearchResult[];
  channels: DisplaySearchResult[];
  conversations: DisplaySearchResult[];
  tickets: DisplaySearchResult[];
  attachments: DisplaySearchResult[];
}
