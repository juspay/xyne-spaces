import { DisplayEntityType, SearchableEntityType } from '@/src/types/search';
import type {
  DisplaySearchResult,
  GlobalSearchFilters,
  PartitionedDisplaySearchResults,
  SearchResult,
  VespaSearchFilters,
  VespaSearchResponseData,
  VespaSearchResultsPage,
} from '@/src/types/search';

/**
 * Sanitizes search query by removing control characters and truncating length.
 * NFKC matches dashboard so exotic spaces (e.g. U+202F in filenames) fold correctly.
 */
export function sanitizeSearchQuery(query: string): string {
  return (
    query
      .normalize('NFKC')
      .trim()
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .substring(0, 500)
  );
}

/**
 * Builds query params for the legacy /search endpoint.
 */
export function buildDefaultSearchParams(filters: GlobalSearchFilters): Record<string, string> {
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
 * Builds query params for /vespaSearch.
 */
export function buildVespaSearchParams(filters: VespaSearchFilters): Record<string, string> {
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

  if (filters.with) {
    params['withUser'] = filters.with;
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

  if (filters.subApp) {
    params['subApp'] = filters.subApp;
  }

  if (filters.callType) {
    params['callType'] = filters.callType;
  }

  if (filters.filterOnly !== undefined) {
    params['filterOnly'] = filters.filterOnly.toString();
  }

  if (filters.presentationSummary) {
    params['presentationSummary'] = filters.presentationSummary;
  }

  if (filters.onlyMyChannels !== undefined) {
    params['onlyMyChannels'] = filters.onlyMyChannels.toString();
  }

  return params;
}

/**
 * Flattens grouped or flat vespa payloads into one consistent page shape.
 */
export function normalizeVespaSearchResponseData(
  data: VespaSearchResponseData,
): VespaSearchResultsPage {
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

  return {
    results: data.results || [],
    totalCount: data.totalCount,
    offset: data.offset,
    limit: data.limit,
  };
}

/**
 * Maps backend result type to frontend display type.
 */
export function mapSearchResultType(
  backendType: SearchableEntityType,
): (typeof DisplayEntityType)[keyof typeof DisplayEntityType] {
  switch (backendType) {
    case SearchableEntityType.MESSAGES:
      return DisplayEntityType.CONVERSATION;
    case SearchableEntityType.USERS:
      return DisplayEntityType.USER;
    case SearchableEntityType.CHANNELS:
      return DisplayEntityType.CHANNEL;
    case SearchableEntityType.TICKETS:
      return DisplayEntityType.TICKET;
    case SearchableEntityType.ATTACHMENTS:
      return DisplayEntityType.ATTACHMENT;
    default:
      return DisplayEntityType.CONVERSATION;
  }
}

/**
 * Transform backend /search results into display-friendly shape.
 */
export function transformSearchResultsToDisplay(results: SearchResult[]): DisplaySearchResult[] {
  return results.map(result => transformSearchResultToDisplay(result));
}

/**
 * Transform a single backend /search result into display-friendly shape.
 */
export function transformSearchResultToDisplay(result: SearchResult): DisplaySearchResult {
  const baseResult: DisplaySearchResult = {
    type: mapSearchResultType(result.type),
    id: result.id,
    title: result.title,
    subtitle: result.subtitle || generateSearchSubtitle(result),
    context: result.content,
    relevanceScore: result.relevanceScore,
    ...(result.context && { searchContext: result.context }),
    metadata: {
      timestamp: formatSearchTimestamp(result.createdAt),
    },
  };

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
        type: DisplayEntityType.CONVERSATION,
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
        ? formatSearchFileSize(result.context.fileSize)
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

export function generateSearchSubtitle(result: SearchResult): string {
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
 * Epoch-millis cursor for a search result, as a string, or undefined.
 *
 * `/vespaSearch` returns DisplaySearchResult objects verbatim — normalize
 * passes them straight through — so the only timestamps available are the ones
 * the backend puts on the result itself.
 *
 * `metadata.timestamp` is UTC wall-clock with no zone marker (the backend
 * builds it with toLocaleString(..., { timeZone: 'UTC' })). Parsing it as-is
 * silently reads it as device-local and skews the cursor by the offset, which
 * is why " UTC" is appended first — the same correction
 * formatSearchResultTimestamp already applies for display.
 */
export function resolveSearchResultCreatedAtMs(
  result: Pick<DisplaySearchResult, 'createdAt' | 'searchContext'> & {
    metadata?: DisplaySearchResult['metadata'];
  },
): string | undefined {
  const epoch = result.searchContext?.createdAtTimestamp;
  if (typeof epoch === 'number' && Number.isFinite(epoch)) {
    return String(epoch);
  }

  const isoParsed = result.createdAt ? Date.parse(result.createdAt) : Number.NaN;
  if (Number.isFinite(isoParsed)) {
    return String(isoParsed);
  }

  const metadataTimestamp = result.metadata?.timestamp?.trim();
  if (!metadataTimestamp || metadataTimestamp === 'N/A') return undefined;

  const zoned = /(?:UTC|Z|GMT|[+-]\d{2}:?\d{2})$/i.test(metadataTimestamp)
    ? metadataTimestamp
    : `${metadataTimestamp} UTC`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? String(parsed) : undefined;
}

export function formatSearchTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
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

export function formatSearchFileSize(bytes?: number): string | undefined {
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
 * Convenience grouping used by tabbed/chip-based search UIs.
 */
export function partitionDisplaySearchResults(
  results: DisplaySearchResult[],
): PartitionedDisplaySearchResults {
  const partitioned: PartitionedDisplaySearchResults = {
    users: [],
    channels: [],
    conversations: [],
    tickets: [],
    attachments: [],
  };

  for (const result of results) {
    switch (result.type) {
      case DisplayEntityType.USER:
        partitioned.users.push(result);
        break;
      case DisplayEntityType.CHANNEL:
        partitioned.channels.push(result);
        break;
      case DisplayEntityType.CONVERSATION:
        partitioned.conversations.push(result);
        break;
      case DisplayEntityType.TICKET:
        partitioned.tickets.push(result);
        break;
      case DisplayEntityType.ATTACHMENT:
        partitioned.attachments.push(result);
        break;
      default:
        break;
    }
  }

  return partitioned;
}
