// Frontend search types that mirror the backend search types

// Display types for frontend UI (some singular, conversation instead of messages)
export type DisplayEntityType =
  | 'user'
  | 'channel'
  | 'conversation'
  | 'ticket'
  | 'attachment'
  | 'collection';

export interface SearchContext {
  channelId?: string;
  channelTitle?: string;
  scopeType?: string; // Channel scope type: 'DM', 'GROUP_DM', 'DEFAULT', etc.
  conversationId?: string;
  messageId?: string;
  replyCount?: number; // Number of replies - determines if message is a thread
  isRootMessage?: boolean; // True when this message is the conversation's initial/root message
  msgType?: string; // Message type (USER/BOT/SYSTEM/…) — used to fabricate the message from search
  threadSenders?: string[]; // User ids of thread participants — used for the reply-avatar preview
  attachmentIds?: string[]; // Vespa file doc ids for attachments owned by this message
  orgName?: string;
  senderName?: string;
  senderEmail?: string;
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
  formFieldMatches?: Array<{
    fieldId: string;
    fieldName?: string;
    fieldValue: string; // HTML-escaped value with Vespa-style <hi> tags around query matches
  }>;
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
  fileId?: string; // Comma-separated Vespa file doc ids
  searchId?: string;
  // Ticket-specific filters
  priority?: string; // HIGH, MEDIUM, LOW, CRITICAL
  board?: string; // Board name/ID
  tags?: string; // Comma-separated tags — ticket labels and message tags alike
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

  // Cmd-K exact-match toggle. The query is quoted on the way out (see
  // buildVespaSearchParams) so the backend reads it as a phrase; the quotes are never
  // shown in the box, which is why this is a flag rather than part of the text.
  exactMatch?: boolean;

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
