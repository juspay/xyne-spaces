import { apiInstance } from './clients/apiClient';
import {
  GlobalSearchFilters,
  PaginatedSearchResults,
  SearchApiResponse,
  DisplaySearchResult,
  SearchResult,
  SearchableEntityType,
  DisplayEntityType,
  VespaSearchResponse,
  VespaSearchFilters,
} from '../types/search';

/**
 * Sanitizes search query by removing potentially harmful characters
 */
export function sanitizeSearchQuery(query: string): string {
  return (
    query
      .trim()
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '') // Remove control characters
      .substring(0, 500)
  ); // Enforce max length
}

export class SearchService {
  private defaultBaseUrl = '/search';
  private vespaBaseUrl = '/vespaSearch';

  /**
   * Perform default global search with GlobalSearchFilters
   */
  async globalSearch(filters: GlobalSearchFilters): Promise<PaginatedSearchResults> {
    try {
      // Sanitize the query
      const sanitizedFilters = {
        ...filters,
        query: sanitizeSearchQuery(filters.query),
      };

      const params = this.buildDefaultSearchParams(sanitizedFilters);

      const response = await apiInstance.get<SearchApiResponse>(this.defaultBaseUrl, {
        params,
      });

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error || 'Search request failed');
      }
      return response.data.data;
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Search request failed');
    }
  }

  /**
   * Perform Vespa search across all indexed documents
   */
  async vespaSearch(filters: VespaSearchFilters): Promise<{
    results: DisplaySearchResult[];
    totalCount: number;
    offset: number;
    limit: number;
  }> {
    try {
      // Sanitize the query
      const sanitizedFilters = {
        ...filters,
        query: sanitizeSearchQuery(filters.query),
      };

      const params = this.buildVespaSearchParams(sanitizedFilters);

      const response = await apiInstance.get<VespaSearchResponse>(this.vespaBaseUrl, {
        params,
      });

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error || 'Vespa search request failed');
      }

      const data = response.data.data;

      // Handle grouped results - flatten them for backward compatibility
      if (data.grouped && data.groups) {
        const flattenedResults: DisplaySearchResult[] = [];
        for (const group of data.groups) {
          flattenedResults.push(...group.results);
        }

        return {
          results: flattenedResults.filter(result => result.relevanceScore > 0),
          totalCount: data.totalCount,
          offset: data.offset,
          limit: data.limit,
        };
      }

      // Handle flat results (backward compatible)
      return {
        results: data.results || [],
        totalCount: data.totalCount,
        offset: data.offset,
        limit: data.limit,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Vespa search request failed');
    }
  }

  /**
   * Transform backend search results to frontend display format
   */
  transformToDisplayResults(results: SearchResult[]): DisplaySearchResult[] {
    return results.map(result => this.transformSingleResult(result));
  }

  /**
   * Transform a single backend search result to frontend display format
   */
  private transformSingleResult(result: SearchResult): DisplaySearchResult {
    const baseResult: DisplaySearchResult = {
      type: this.mapResultType(result.type),
      id: result.id,
      title: result.title,
      subtitle: result.subtitle || this.generateSubtitle(result),
      context: result.content,
      relevanceScore: result.relevanceScore,
      ...(result.context && { searchContext: result.context }), // Preserve the original context for navigation
      metadata: {
        timestamp: this.formatTimestamp(result.createdAt),
      },
    };

    // Add type-specific metadata
    switch (result.type) {
      case SearchableEntityType.USERS:
        return {
          ...baseResult,
          avatar: result.id,
          subtitle: result.subtitle || 'User',
        };

      case SearchableEntityType.CHANNELS:
        return {
          ...baseResult,
          title: result.title.startsWith('#') ? result.title : `#${result.title}`,
          subtitle: result.subtitle || 'Channel',
          metadata: {
            ...baseResult.metadata,
            ...(result.context?.channelTitle && { channelName: result.context.channelTitle }),
          },
        };

      case SearchableEntityType.MESSAGES: {
        const truncatedContent =
          result.content.length > 50 ? result.content.substring(0, 50) + '...' : result.content;

        return {
          ...baseResult,
          type: 'conversation',
          ...(result.context?.senderId && { avatar: result.context.senderId }),
          subtitle: result.context?.senderName
            ? `${result.context.senderName}: ${truncatedContent}`
            : truncatedContent,
          metadata: {
            ...baseResult.metadata,
            ...(result.context?.channelTitle && { channelName: result.context.channelTitle }),
          },
        };
      }

      case SearchableEntityType.TICKETS:
        return {
          ...baseResult,
          subtitle: result.context?.ticketStatus
            ? `${result.context.ticketStatus} - ${result.subtitle || 'Ticket'}`
            : result.subtitle || 'Ticket',
          metadata: {
            ...baseResult.metadata,
            ...(result.context?.ticketStatus && { status: result.context.ticketStatus }),
          },
        };

      case SearchableEntityType.ATTACHMENTS: {
        const fileSize = result.context?.fileSize
          ? this.formatFileSize(result.context.fileSize)
          : undefined;
        return {
          ...baseResult,
          subtitle: result.context?.senderName
            ? `Shared by ${result.context.senderName}`
            : 'Attachment',
          metadata: {
            ...baseResult.metadata,
            ...(result.context?.channelTitle && { channelName: result.context.channelTitle }),
            ...(fileSize && { fileSize }),
          },
        };
      }

      default:
        return baseResult;
    }
  }

  /**
   * Map backend result type to frontend display type
   */
  private mapResultType(backendType: SearchableEntityType): DisplayEntityType {
    switch (backendType) {
      case SearchableEntityType.MESSAGES:
        return 'conversation';
      case SearchableEntityType.USERS:
        return 'user';
      case SearchableEntityType.CHANNELS:
        return 'channel';
      case SearchableEntityType.TICKETS:
        return 'ticket';
      case SearchableEntityType.ATTACHMENTS:
        return 'attachment';
      default:
        return 'conversation';
    }
  }

  /**
   * Generate subtitle for results that don't have one
   */
  private generateSubtitle(result: SearchResult): string {
    switch (result.type) {
      case SearchableEntityType.USERS:
        return 'User';
      case SearchableEntityType.CHANNELS:
        return 'Channel';
      case SearchableEntityType.MESSAGES:
        return result.content.substring(0, 50) + (result.content.length > 50 ? '...' : '');
      case SearchableEntityType.TICKETS:
        return 'Ticket';
      case SearchableEntityType.ATTACHMENTS:
        return 'Attachment';
      default:
        return '';
    }
  }

  /**
   * Format timestamp for display
   */
  private formatTimestamp(timestamp: string): string {
    try {
      const date = new Date(timestamp);
      // Format to include both date and time: "Dec 4, 3:45 PM"
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return timestamp;
    }
  }

  /**
   * Format file size for display
   */
  private formatFileSize(bytes?: number): string | undefined {
    if (bytes === undefined || bytes === null || isNaN(bytes)) {
      return undefined;
    }

    if (bytes === 0) {
      return '0 KB';
    }

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Build query parameters for default search request
   */
  private buildDefaultSearchParams(filters: GlobalSearchFilters): Record<string, string> {
    const params: Record<string, string> = {
      query: filters.query,
    };

    if (filters.entityTypes && filters.entityTypes.length > 0) {
      params['entityTypes'] = filters.entityTypes.join(',');
    }

    if (filters.orgName) {
      params['orgName'] = filters.orgName;
    }

    if (filters.channelIds) {
      params['channelIds'] = filters.channelIds.join(',');
    }

    if (filters.userIds) {
      params['userIds'] = filters.userIds.join(',');
    }

    if (filters.dateRange) {
      params['dateRange'] = JSON.stringify(filters.dateRange);
    }

    if (filters.page) {
      params['page'] = filters.page.toString();
    }

    if (filters.limit) {
      params['limit'] = filters.limit.toString();
    }

    if (filters.searchType) {
      params['searchType'] = filters.searchType;
    }

    if (filters.sort) {
      params['sort'] = filters.sort;
    }

    return params;
  }

  /**
   * Build query parameters for Vespa search request
   */
  private buildVespaSearchParams(filters: VespaSearchFilters): Record<string, string> {
    const params: Record<string, string> = {
      q: filters.query,
    };

    if (filters.apps) {
      params['apps'] = filters.apps;
    }

    if (filters.type) {
      params['type'] = filters.type;
    }

    if (filters.from) {
      params['from'] = filters.from;
    }

    if (filters.in) {
      params['in'] = filters.in;
    }

    if (filters.offset !== undefined) {
      params['offset'] = filters.offset.toString();
    }

    if (filters.limit !== undefined) {
      params['limit'] = filters.limit.toString();
    }

    if (filters.rankProfile) {
      params['rankProfile'] = filters.rankProfile;
    }

    if (filters.projectId) {
      params['projectId'] = filters.projectId;
    }

    if (filters.status) {
      params['status'] = filters.status;
    }

    if (filters.ticketId) {
      params['ticketId'] = filters.ticketId;
    }

    if (filters.includeDebugInfo !== undefined) {
      params['includeDebugInfo'] = filters.includeDebugInfo.toString();
    }

    if (filters.searchId) {
      params['searchId'] = filters.searchId;
    }

    if (filters.priority) {
      params['priority'] = filters.priority;
    }

    if (filters.board) {
      params['board'] = filters.board;
    }

    if (filters.tags) {
      params['tags'] = filters.tags;
    }

    if (filters.before) {
      params['before'] = filters.before;
    }

    if (filters.after) {
      params['after'] = filters.after;
    }

    if (filters.on) {
      params['on'] = filters.on;
    }

    if (filters.range) {
      params['range'] = filters.range;
    }

    if (filters.stage) {
      params['stage'] = filters.stage;
    }

    if (filters.assignee) {
      params['assignee'] = filters.assignee;
    }

    if (filters.filterOnly !== undefined) {
      params['filterOnly'] = filters.filterOnly.toString();
    }

    return params;
  }
}

// Export singleton instance
export const searchService = new SearchService();
