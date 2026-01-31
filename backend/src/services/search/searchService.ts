import { SearchRepository } from '../../database/repositories/searchRepository';
import {
  GlobalSearchFilters,
  PaginatedSearchResults,
  SearchResult,
  UnifiedSearchRow,
} from './types';
import { QueryValidationService } from './QueryValidationService';
import { SearchQueryBuilder } from './SearchQueryBuilder';


export class SearchService {
  private searchRepository: SearchRepository;
  private queryValidationService: QueryValidationService;
  private queryBuilder: SearchQueryBuilder;

  constructor() {
    this.searchRepository = new SearchRepository();
    this.queryValidationService = new QueryValidationService();
    this.queryBuilder = new SearchQueryBuilder();
  }

  /**
   * Global search with unified UNION ALL query and database-level pagination
   * 
   * This method uses a single database query to search across all entity types:
   * - Single UNION ALL query instead of multiple separate queries
   * - Database-level sorting and pagination for efficiency
   * - Accurate total count with COUNT(*) OVER()
   * - No hard limit on total results
   * 
   * Benefits:
   * - 10x fewer database queries (1 vs 10)
   * - Correct pagination across all entity types
   * - Better performance and scalability
   * - Can access all search results, not just first 250
   * 
   * Authorization is enforced at the database level via channel_participants joins
   * 
   * @param filters - Search filters including query, entityTypes, pagination
   * @param userId - Current user ID for authorization
   * @returns Paginated search results with accurate counts
   */
  async performGlobalSearch(
    filters: GlobalSearchFilters,
    userId: string
  ): Promise<PaginatedSearchResults> {
    const startTime = Date.now();

    // Validate input
    this.queryValidationService.validate(filters);

    // Build unified SQL query with UNION ALL
    const { sql, params } = this.queryBuilder.buildUnifiedQuery(filters, userId);

    // Execute single query in database
    const unifiedRows = await this.searchRepository.executeUnifiedSearch(sql, params);

    // Fetch participant names for DM and GROUP_DM channels
    const participantNamesMap = await this.fetchParticipantNames(unifiedRows, userId);

    // Transform database rows to SearchResult format (parse JSON context, handle types)
    const results = this.transformRows(unifiedRows, participantNamesMap);

    // Extract total count from first row (all rows have same total_count from COUNT(*) OVER())
    const total = unifiedRows.length > 0 
      ? (typeof unifiedRows[0].total_count === 'string' 
          ? parseInt(unifiedRows[0].total_count, 10) 
          : unifiedRows[0].total_count)
      : 0;

    // Calculate pagination metadata
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const hasMore = (page * limit) < total;

    // Calculate aggregations by counting entity types in current page results
    // Note: These counts reflect only the current page, not total counts per type
    const aggregations = {
      userCount: results.filter(r => r.type === 'users').length,
      messageCount: results.filter(r => r.type === 'messages').length,
      channelCount: results.filter(r => r.type === 'channels').length,
      ticketCount: results.filter(r => r.type === 'tickets').length,
      attachmentCount: results.filter(r => r.type === 'attachments').length,
    };

    const searchTime = `${Date.now() - startTime}ms`;

    return {
      results,
      pagination: {
        page,
        limit,
        total,
        hasMore,
      },
      aggregations,
      meta: {
        query: filters.query,
        searchTime,
        searchType: filters.searchType || 'both',
      },
    };
  }

  /**
   * Fetch participant names for DM and GROUP_DM channels in search results
   * 
   * Extracts channel IDs from results that need name transformation,
   * fetches participant names in a single query, and returns a map
   * 
   * @param rows - Unified search rows
   * @param userId - Current user ID (excluded from participant names)
   * @returns Map of channelId to array of participant names
   */
  private async fetchParticipantNames(
    rows: UnifiedSearchRow[],
    userId: string
  ): Promise<Map<string, string[]>> {
    // Extract channel IDs that need participant name transformation
    const channelIds = new Set<string>();
    
    for (const row of rows) {
      // Check if this is a channel or message result with DM/GROUP_DM scope
      if (row.context_json) {
        const context = JSON.parse(row.context_json);
        
        // For channels with DM/GROUP_DM scope
        if (row.entity_type === 'channels' && 
            (context.scopeType === 'DM' || context.scopeType === 'GROUP_DM')) {
          channelIds.add(row.id);
        }
        
        // For messages in DM/GROUP_DM channels
        if (row.entity_type === 'messages' && 
            context.channelId &&
            (context.scopeType === 'DM' || context.scopeType === 'GROUP_DM')) {
          channelIds.add(context.channelId);
        }
      }
    }

    // Fetch participant names if we have any DM/GROUP_DM channels
    if (channelIds.size > 0) {
      return await this.searchRepository.getChannelParticipantNames(
        Array.from(channelIds),
        userId
      );
    }

    return new Map();
  }

  /**
   * Transform database rows to SearchResult format
   * 
   * Handles:
   * - Parsing context_json field
   * - Converting relevance_score to number if needed
   * - Converting null to undefined for optional fields
   * - Transforming DM/GROUP_DM channel names to participant names
   */
  private transformRows(
    rows: UnifiedSearchRow[],
    participantNamesMap: Map<string, string[]>
  ): SearchResult[] {
    return rows.map(row => {
      const context = row.context_json ? JSON.parse(row.context_json) : undefined;
      let title = row.title;
      let subtitle = row.subtitle || undefined;

      // Transform DM/GROUP_DM channel names to participant names
      if (context) {
        // For channel results
        if (row.entity_type === 'channels' && 
            (context.scopeType === 'DM' || context.scopeType === 'GROUP_DM')) {
          const participantNames = participantNamesMap.get(row.id);
          if (participantNames && participantNames.length > 0) {
            title = participantNames.join(', ');
          }
        }
        
        // For message results in DM/GROUP_DM channels
        if (row.entity_type === 'messages' && 
            context.channelId &&
            (context.scopeType === 'DM' || context.scopeType === 'GROUP_DM')) {
          const participantNames = participantNamesMap.get(context.channelId);
          if (participantNames && participantNames.length > 0) {
            // Replace title to show it's a message in the DM/GROUP_DM
            title = 'Message in ' + participantNames.join(', ');
            // Replace subtitle with sender name (from context)
            subtitle = 'By ' + (context.senderName || 'Unknown');
          }
        }
      }
      
      return {
        id: row.id,
        type: row.entity_type,
        title,
        subtitle,
        content: row.content,
        relevanceScore: typeof row.relevance_score === 'number' 
          ? row.relevance_score 
          : parseFloat(row.relevance_score as string),
        createdAt: row.created_at,
        avatar: row.avatar || undefined,
        context,
      };
    });
  }
}
