export type SearchableEntityType = 'users' | 'messages' | 'channels' | 'tickets' | 'attachments';

/**
 * Unified search row returned from database UNION ALL query
 * 
 * This is the standardized structure returned by SearchQueryBuilder.
 * All entity types are normalized to this structure in the database query,
 * then transformed to SearchResult in the service layer.
 */
export interface UnifiedSearchRow {
  id: string;
  entity_type: SearchableEntityType;
  title: string;
  subtitle: string | null;
  content: string;
  context_json: string | null; // JSON string, parsed in transformation
  avatar: string | null;
  relevance_score: number;
  created_at: Date;
  total_count: string | number; // COUNT(*) OVER() returns bigint as string
}

/**
 * Global search filter parameters
 * 
 * Used to specify search criteria, entity types to search,
 * and pagination parameters.
 */
export interface GlobalSearchFilters {
  query: string;
  entityTypes?: SearchableEntityType[];
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

/**
 * Validated query parameters from the search endpoint
 * After Joi validation and transformation
 */
export interface SearchQueryParams {
  query: string;
  entityTypes?: string[];
  channelIds?: string[];
  userIds?: string[];
  dateRange?: { from?: string; to?: string };
  page: number;
  limit: number;
  searchType?: 'trigram' | 'fts' | 'both';
  sort?: 'relevance' | 'newest' | 'oldest';
}

/**
 * Unified search result for API response
 * 
 * This is the format returned to the frontend.
 * All entity types are transformed to this structure.
 */
export interface SearchResult {
  id: string;
  type: SearchableEntityType;
  title: string;
  subtitle?: string;
  content: string;
  relevanceScore: number;
  createdAt: Date;
  avatar?: string;
  context?: SearchContext;
}

/**
 * Entity-specific context data
 * 
 * This contains additional information specific to each entity type,
 * used by the frontend for navigation and display.
 */
export interface SearchContext {
  channelId?: string;
  channelTitle?: string;
  conversationId?: string;
  messageId?: string;
  replyCount?: number; // Number of replies - determines if message is a thread
  senderName?: string;
  senderId?: string;
  ticketId?: string;
  ticketStatus?: string;
  attachmentId?: string;
  fileName?: string;
  mimeType?: string;
}

/**
 * Paginated search results response
 * 
 * This is the complete API response structure including
 * results, pagination metadata, aggregations, and search metadata.
 */
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
