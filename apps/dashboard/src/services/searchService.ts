import { apiInstance } from './clients/apiClient';
import { DisplaySearchResult, VespaSearchResponse, VespaSearchFilters } from '../types/search';
import { buildVespaSearchCacheKey } from './vespaSearchCacheKey';
import { toSearchQuery } from '../utils/exactSearch';
/**
 * Sanitizes search query by removing potentially harmful characters
 */
export function sanitizeSearchQuery(query: string): string {
  return (
    query
      // NFKC folds exotic characters to canonical form — notably U+202F (the narrow no-break
      // space in macOS screenshot names) -> a plain space, matching how filenames are stored.
      .normalize('NFKC')
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
  async vespaSearch(
    filters: VespaSearchFilters,
    signal?: AbortSignal,
    opts?: { cache?: boolean },
  ): Promise<{
    results: DisplaySearchResult[];
    totalCount: number;
    offset: number;
    limit: number;
    grouped: boolean;
  }> {
    try {
      // Sanitize the query
      const sanitizedFilters = {
        ...filters,
        query: sanitizeSearchQuery(filters.query),
      };

      const params = this.buildVespaSearchParams(sanitizedFilters);

      // Opt-in handoff cache: serve the most recent identical cmd+K search (see cachedVespaSearch).
      const cacheKey = opts?.cache ? buildVespaSearchCacheKey(params) : null;
      if (
        cacheKey &&
        cachedVespaSearch?.key === cacheKey &&
        cachedVespaSearch.expiresAt > Date.now()
      ) {
        return cachedVespaSearch.value;
      }

      const response = await apiInstance.get<VespaSearchResponse>(this.vespaBaseUrl, {
        params,
        ...(signal ? { signal } : {}),
      });

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.error || 'Vespa search request failed');
      }

      const data = response.data.data;
      // Whether anything ranked these results — a filter-only search has no query text.
      const hasQuery = Boolean(sanitizedFilters.query?.trim());

      // Handle grouped results - flatten them for backward compatibility
      let vespaResult: VespaSearchResult;
      if (data.grouped && data.groups) {
        const flattenedResults: DisplaySearchResult[] = [];
        for (const group of data.groups) {
          flattenedResults.push(...group.results);
        }

        vespaResult = {
          // Zero-score rows are only noise when a query ranked them. A filter-only search
          // (`q=` empty, filterOnly=true) has nothing to rank against, so Vespa scores every
          // match 0 — dropping them here threw away the entire result set for a chip-only
          // search like `from:@someone` or a date range.
          results: flattenedResults.filter(result => !hasQuery || result.relevanceScore > 0),
          totalCount: data.totalCount,
          offset: data.offset,
          limit: data.limit,
          grouped: true,
        };
      } else {
        // Handle flat results (backward compatible)
        vespaResult = {
          results: data.results || [],
          totalCount: data.totalCount,
          offset: data.offset,
          limit: data.limit,
          grouped: false,
        };
      }

      // Store on success only; a new text/toggle/tab/offset yields a new key and overwrites.
      if (cacheKey) {
        cachedVespaSearch = {
          key: cacheKey,
          value: vespaResult,
          expiresAt: Date.now() + VESPA_SEARCH_CACHE_TTL_MS,
        };
      }
      return vespaResult;
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
    // Exact match is expressed by quoting the query, which is what the backend's phrase
    // grammar keys off. Done here rather than in the box so the user never sees the quotes.
    // Same helper the ticket search uses, so the two surfaces can't drift on what "exact"
    // means or on where the mode stops being a flag and becomes text.
    const params: Record<string, string> = {
      q: toSearchQuery(filters.query, filters.exactMatch === true),
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

// 30s: gives the popup → full-screen handoff headroom to reuse the popup's search even if
// the results page is slow to mount, while still bounding how stale a reused result can be.
const VESPA_SEARCH_CACHE_TTL_MS = 30_000;

type VespaSearchResult = Awaited<ReturnType<SearchService['vespaSearch']>>;

// Single-slot handoff cache. Lets ONLY the cmd+K popup → full-screen results navigation (and
// the full-screen → back → popup return) reuse the popup's last search instead of re-hitting
// Vespa. Opt-in only (the `cache` option), so other vespaSearch callers stay always-fresh.
// A fresh cmd+K open invalidates it (see clearVespaSearchCache), so re-opening the palette
// always fetches fresh — only the in-flight handoff survives. Module state is also wiped on
// the hard reload a workspace switch triggers, so there is no cross-workspace leak.
let cachedVespaSearch: { key: string; value: VespaSearchResult; expiresAt: number } | null = null;

// Drop the handoff entry so the next search fetches fresh. Called when the cmd+K palette is
// opened anew (not on the back-navigation restore), so a reopened palette never serves a
// result cached by an earlier session.
export function clearVespaSearchCache(): void {
  cachedVespaSearch = null;
}

// Export singleton instance
export const searchService = new SearchService();
