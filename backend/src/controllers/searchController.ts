import { Request, Response } from 'express';
import { SearchService, GlobalSearchFilters, SearchQueryParams } from '../services/search';
import {logger} from '@/utils/logger';

export class SearchController {
  private searchService: SearchService;

  constructor() {
    this.searchService = new SearchService();
  }

  /**
   * GET /api/search - Global search endpoint
   * Searches across users, messages, and channels with filtering and pagination
   */
  globalSearch = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;

      // Extract validated query parameters (already validated by middleware)
      const {
        query,
        entityTypes,
        channelIds,
        userIds,
        dateRange,
        page,
        limit,
        searchType,
        sort,
      } = req.query as unknown as SearchQueryParams;

      // Build search filters (no validation needed - already done by Joi)
      const filters: GlobalSearchFilters = {
        query: query.trim(),
        entityTypes: entityTypes as GlobalSearchFilters['entityTypes'],
        channelIds,
        userIds,
        dateRange,
        page,
        limit,
        searchType,
        sort,
      };

      logger.info('🔍 [SEARCH-API] Global search called:', {
        userId,
        query: filters.query,
        entityTypes: filters.entityTypes,
        channelIds: filters.channelIds,
        userIds: filters.userIds,
        page: filters.page,
        limit: filters.limit,
      });

      // Perform search
      const searchResults = await this.searchService.performGlobalSearch(filters, userId);

      logger.info('✅ [SEARCH-API] Global search completed:', {
        totalResults: searchResults.pagination.total,
        aggregations: searchResults.aggregations,
        searchTime: searchResults.meta.searchTime,
      });

      res.status(200).json({
        success: true,
        data: searchResults,
      });
    } catch (error) {
      logger.error('❌ [SEARCH-API] Global search error:', error);

      // Never expose internal error details to clients
      // Log the full error for debugging, but return a generic message
      res.status(500).json({
        success: false,
        error: 'An error occurred while processing your search request',
      });
    }
  };

}
