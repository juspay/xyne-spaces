// Frontend search types that mirror the backend search types

// Entity types from backend (plural form) - using const object due to erasableSyntaxOnly
export const SearchableEntityType = {
  USERS: 'users',
  MESSAGES: 'messages',
  CHANNELS: 'channels',
  TICKETS: 'tickets',
  ATTACHMENTS: 'attachments',
} as const;

export type SearchableEntityType = (typeof SearchableEntityType)[keyof typeof SearchableEntityType];

// Display types for frontend UI (some singular, conversation instead of messages)
export type DisplayEntityType =
  | 'user'
  | 'channel'
  | 'conversation'
  | 'ticket'
  | 'attachment'
  | 'collection';

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

export interface SearchContext {
  channelId?: string;
  channelTitle?: string;
  scopeType?: string; // Channel scope type: 'DM', 'GROUP_DM', 'DEFAULT', etc.
  conversationId?: string;
  messageId?: string;
  replyCount?: number; // Number of replies - determines if message is a thread
  orgName?: string;
  senderName?: string;
  senderId?: string;
  ticketId?: string;
  xyneId?: string;
  ticketStatus?: string;
  boardId?: string;
  assignedTo?: string;
  assigneeName?: string;
  createdBy?: string;
  creatorName?: string;
  priority?: string;
  stageName?: string;
  projectId?: string;
  createdAtTimestamp?: number;
  ticketType?: string;
  userGroupId?: string;
  tags?: string[];
  mailId?: string; // externalMessageId for mail results (used for scroll-to)
  recipientCount?: number; // total to+cc+bcc (excluding sender) for mail results
  attachmentId?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  internalUrl?: string;
  originalUrl?: string;
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
  // Knowledge base / collection specific fields
  collectionId?: string;
  docId?: string;
  folderId?: string;
  subApp?: string;
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

// Frontend display types for the UI components
export interface DisplaySearchResult {
  type: DisplayEntityType;
  id: string;
  title: string;
  subtitle: string;
  context?: string;
  avatar?: string;
  metadata: {
    channelName?: string;
    timestamp?: string;
    status?: string;
    fileSize?: string;
    unreadCount?: number;
  };
  // Preserve the original search context for navigation
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

// Vespa-specific types
export interface VespaSearchFilters {
  query: string;
  type?: string; // 'messages' | 'attachments' | 'channels' | 'tickets' | 'users'
  from?: string; // User IDs
  fromEmail?: string; // Desk-only: sender email address(es) for the mail `from:` filter
  toEmail?: string; // Desk-only: recipient email address(es) for the mail `to:` filter
  with?: string; // User ID for participant filter (matches userId, threadMentions, threadSenders)
  in?: string; // Channel IDs (scope: within channel/DM)
  mentions?: string; // User IDs the message mentions (scoped mention search; bare @user chip)
  channelMentions?: string; // Channel IDs the message references (scoped mention search; bare #channel chip)
  mentionHighlights?: string[]; // Display name(s) of bare mention chips — highlighted in results, not in YQL
  offset?: number;
  limit?: number;
  apps?: string; // 'slack,ticket,user'
  rankProfile?: string;
  includeDebugInfo?: boolean; // Include matchfeatures and rankfeatures
  // Additional filters
  projectId?: string;
  status?: string;
  ticketId?: string;
  searchId?: string;
  // Ticket-specific filters
  priority?: string; // HIGH, MEDIUM, LOW, CRITICAL
  board?: string; // Board name/ID
  tags?: string; // Comma-separated tags
  before?: string; // Created before date (multiple formats)
  after?: string; // Created after date (multiple formats)
  on?: string; // Created on specific date (multiple formats)
  range?: string; // Time keyword (today, yesterday, this week, last 7 days, etc.)
  stage?: string; // Ticket stage
  assignee?: string; // Assigned user ID
  dynamicFieldValues?: string | string[]; // Comma-separated or array of fieldId::value tokens
  dynamicFieldDateRanges?: Record<string, { start?: number; end?: number }>;
  subApp?: string; // Comma-separated sub-apps: 'canvas', 'transcript', 'RCA'
  callType?: string; // Comma-separated call types: 'HEADLESS'
  callStatus?: string; // Comma-separated call statuses: 'SCHEDULED'
  callStartsAt?: number; // Call visible range start timestamp
  callEndsAt?: number; // Call visible range end timestamp
  presentationSummary?: string; // Vespa presentation.summary profile (e.g. 'lean')

  // Filter-only mode (no query text, just filters)
  filterOnly?: boolean;

  // Cmd-K "Include bot messages" toggle. Default off → backend excludes BOT messages.
  includeBotMessages?: boolean;

  // Cmd-K "Include my channels" toggle. Default on → backend scopes to member channels.
  onlyMyChannels?: boolean;

  // Override Vespa grouping. Empty string => flat ranked list (no grouping).
  groupBy?: string;
}

export interface VespaSearchGroup {
  groupBy: string;
  groupValue: string;
  count: number;
  results: DisplaySearchResult[];
}

export interface VespaSearchResponse {
  success: boolean;
  data: {
    grouped?: boolean;
    groups?: VespaSearchGroup[];
    results?: DisplaySearchResult[];
    totalCount: number;
    offset: number;
    limit: number;
  };
  error?: string;
}
