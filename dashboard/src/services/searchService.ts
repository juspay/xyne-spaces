import { apiInstance } from './clients/apiClient';
import { DisplaySearchResult, VespaSearchResponse, VespaSearchFilters } from '../types/search';

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
  private vespaBaseUrl = '/vespaSearch';

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

    if (filters.fromEmail) {
      params['fromEmail'] = filters.fromEmail;
    }

    if (filters.toEmail) {
      params['toEmail'] = filters.toEmail;
    }

    if (filters.with) {
      params['withUser'] = filters.with;
    }

    if (filters.in) {
      params['in'] = filters.in;
    }

    if (filters.mentions) {
      params['mentions'] = filters.mentions;
    }

    if (filters.channelMentions) {
      params['channelMentions'] = filters.channelMentions;
    }

    // Highlight-only display names; JSON-encoded since names can contain commas.
    if (filters.mentionHighlights && filters.mentionHighlights.length > 0) {
      params['mentionHighlights'] = JSON.stringify(filters.mentionHighlights);
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

    if (filters.fileId) {
      params['fileId'] = filters.fileId;
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

    if (filters.dynamicFieldValues) {
      params['dynamicFieldValues'] = Array.isArray(filters.dynamicFieldValues)
        ? filters.dynamicFieldValues.join(',')
        : filters.dynamicFieldValues;
    }

    if (filters.dynamicFieldDateRanges) {
      params['dynamicFieldDateRanges'] = JSON.stringify(filters.dynamicFieldDateRanges);
    }

    if (filters.subApp) {
      params['subApp'] = filters.subApp;
    }

    if (filters.callType) {
      params['callType'] = filters.callType;
    }

    if (filters.callStatus) {
      params['callStatus'] = filters.callStatus;
    }

    if (filters.callStartsAt !== undefined) {
      params['callStartsAt'] = filters.callStartsAt.toString();
    }

    if (filters.callEndsAt !== undefined) {
      params['callEndsAt'] = filters.callEndsAt.toString();
    }

    if (filters.presentationSummary) {
      params['presentationSummary'] = filters.presentationSummary;
    }

    if (filters.filterOnly !== undefined) {
      params['filterOnly'] = filters.filterOnly.toString();
    }

    if (filters.includeBotMessages !== undefined) {
      params['includeBotMessages'] = filters.includeBotMessages.toString();
    }

    if (filters.onlyMyChannels !== undefined) {
      params['onlyMyChannels'] = filters.onlyMyChannels.toString();
    }

    if (filters.groupBy !== undefined) {
      params['groupBy'] = filters.groupBy;
    }

    return params;
  }
}

// Export singleton instance
export const searchService = new SearchService();
