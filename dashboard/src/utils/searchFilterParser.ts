/**
 * Regex patterns for filter extraction
 * These are exported to ensure consistency across the codebase
 */
export const TYPE_FILTER_REGEX = /\btype:\s*(\S+)/i;
export const TYPE_AUTOCOMPLETE_REGEX = /\btype:([a-z,]+)$/i;

/**
 * Parse search filters from query text
 * Extracts filter:value patterns and returns cleaned search text + filter values
 */
export function parseSearchFilters(text: string) {
  let searchText = text.trim();
  let board: string | undefined;
  let tags: string | undefined;
  let before: string | undefined;
  let after: string | undefined;
  let on: string | undefined;
  let range: string | undefined;
  let stage: string | undefined;
  let status: string | undefined;
  let assignee: string | undefined;
  let type: string | undefined;

  // `priority:` is intentionally NOT parsed: it's a chip-only filter (via
  // selectedMentions), so raw `priority:` text is left intact for full-text search.

  // Parse board:value
  const boardMatch = searchText.match(/\bboard:\s*(\S+)/i);
  if (boardMatch && boardMatch[1]) {
    board = boardMatch[1];
    searchText = searchText.replace(boardMatch[0], '').trim();
  }

  // Parse tags:value (comma-separated)
  const tagsMatch = searchText.match(/\btags:\s*(\S+)/i);
  if (tagsMatch && tagsMatch[1]) {
    tags = tagsMatch[1];
    searchText = searchText.replace(tagsMatch[0], '').trim();
  }

  // Parse before:date (supports multiple date formats including "dd mon yy")
  const beforeMultiWordMatch = searchText.match(
    /\bbefore:\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4})/i,
  );
  if (beforeMultiWordMatch && beforeMultiWordMatch[1]) {
    before = beforeMultiWordMatch[1];
    searchText = searchText.replace(beforeMultiWordMatch[0], '').trim();
  } else {
    const beforeMatch = searchText.match(/\bbefore:\s*(\S+)/i);
    if (beforeMatch && beforeMatch[1]) {
      before = beforeMatch[1];
      searchText = searchText.replace(beforeMatch[0], '').trim();
    }
  }

  // Parse after:date (supports multiple date formats including "dd mon yy")
  const afterMultiWordMatch = searchText.match(
    /\bafter:\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4})/i,
  );
  if (afterMultiWordMatch && afterMultiWordMatch[1]) {
    after = afterMultiWordMatch[1];
    searchText = searchText.replace(afterMultiWordMatch[0], '').trim();
  } else {
    const afterMatch = searchText.match(/\bafter:\s*(\S+)/i);
    if (afterMatch && afterMatch[1]) {
      after = afterMatch[1];
      searchText = searchText.replace(afterMatch[0], '').trim();
    }
  }

  // Parse on:date (supports multiple date formats including "dd mon yy")
  const onMultiWordMatch = searchText.match(
    /\bon:\s*(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4})/i,
  );
  if (onMultiWordMatch && onMultiWordMatch[1]) {
    on = onMultiWordMatch[1];
    searchText = searchText.replace(onMultiWordMatch[0], '').trim();
  } else {
    const onMatch = searchText.match(/\bon:\s*(\S+)/i);
    if (onMatch && onMatch[1]) {
      on = onMatch[1];
      searchText = searchText.replace(onMatch[0], '').trim();
    }
  }

  // Parse range:keyword (time keywords - supports multi-word like "last 7 days")
  const multiWordRangeMatch = searchText.match(
    /\brange:\s*(last\s+\d+\s+days|last\s+\d+\s+hours|this\s+week|last\s+week|this\s+month|last\s+month|this\s+morning|this\s+afternoon|last\s+hour|last\s+24\s+hours)/i,
  );
  if (multiWordRangeMatch && multiWordRangeMatch[1]) {
    range = multiWordRangeMatch[1].toLowerCase();
    searchText = searchText.replace(multiWordRangeMatch[0], '').trim();
  } else {
    const singleWordRangeMatch = searchText.match(/\brange:\s*(\S+)/i);
    if (singleWordRangeMatch && singleWordRangeMatch[1]) {
      range = singleWordRangeMatch[1].toLowerCase();
      searchText = searchText.replace(singleWordRangeMatch[0], '').trim();
    }
  }

  // Parse stage:value
  const stageMatch = searchText.match(/\bstage:\s*(\S+)/i);
  if (stageMatch && stageMatch[1]) {
    stage = stageMatch[1];
    searchText = searchText.replace(stageMatch[0], '').trim();
  }

  // Parse status:value
  const statusMatch = searchText.match(/\bstatus:\s*(\S+)/i);
  if (statusMatch && statusMatch[1]) {
    status = statusMatch[1];
    searchText = searchText.replace(statusMatch[0], '').trim();
  }

  // Parse type:value (comma-separated: messages, tickets, files, attachments, users, channels, etc.)
  const typeMatch = searchText.match(TYPE_FILTER_REGEX);
  if (typeMatch && typeMatch[1]) {
    type = typeMatch[1].toLowerCase();
    searchText = searchText.replace(typeMatch[0], '').trim();
  }

  // Strip from:/in:/assignee: and any trailing text (handled as filter chips, not text filters)
  searchText = searchText.replace(/\b(from|in|assignee):\s*\S*/gi, '').trim();

  // Clean incomplete filter patterns (`priority` omitted on purpose — see note above).
  searchText = searchText
    .replace(/\b(board|tags|before|after|on|range|stage|status|type):\s*/gi, '')
    .trim();

  return {
    searchText,
    board,
    tags,
    before,
    after,
    on,
    range,
    stage,
    status,
    assignee,
    type,
  };
}

// Types handled locally (no backend call needed)
const LOCAL_TYPES = ['users', 'people', 'channels'];

// Types handled by backend (sent to Vespa)
const BACKEND_TYPES = [
  'messages',
  'attachments',
  'tickets',
  'files',
  'canvas',
  'transcript',
  'rca',
];

const ALL_TYPES = [...LOCAL_TYPES, ...BACKEND_TYPES];

/**
 * Parse a type filter string into individual types
 * @returns Array of trimmed, lowercase type strings
 */
export function parseTypeFilter(typeFilter: string | undefined): string[] {
  const lower = typeFilter?.toLowerCase();
  return lower?.split(',').map(t => t.trim()) || [];
}

/**
 * Check if all parsed types resolve to local-only types (users, people, channels)
 * Uses exact match to avoid ambiguity (e.g., "c" could be "channels" or "canvas")
 */
export function hasLocalTypeFilter(types: string[]): boolean {
  return types.length > 0 && types.every(t => LOCAL_TYPES.includes(t));
}

/**
 * Check if any type is a partial prefix (user is still typing)
 * e.g., "use" is a prefix of "users", "mes" is a prefix of "messages"
 */
export function hasIncompleteType(types: string[]): boolean {
  return types.some(
    t => t.length > 0 && !ALL_TYPES.includes(t) && ALL_TYPES.some(valid => valid.startsWith(t)),
  );
}

/**
 * Filter out local-only types and return only backend-valid types
 * This prevents sending users/people/channels to the backend validator
 */
export function getBackendTypes(types: string[]): string[] {
  return types.filter(t => BACKEND_TYPES.includes(t));
}

const INCOMPLETE_MENTION_FILTER_REGEX = /\b(from|in|assignee):\S+/gi;

export function hasActiveMentionFilter(
  query: string,
  selectedMentions: Array<{ id: string; type: string; prefix?: string }>,
): boolean {
  // Find all mention filter patterns in the query
  const matches = query.match(INCOMPLETE_MENTION_FILTER_REGEX);
  if (!matches || matches.length === 0) {
    return false;
  }

  // Check each match to see if it corresponds to a selected mention
  for (const match of matches) {
    const prefixMatch = match.match(/\b(from|in|assignee):/i);
    if (!prefixMatch || !prefixMatch[1]) continue;

    const prefix = prefixMatch[1].toLowerCase();
    // Map prefix to mention type
    const mentionType = prefix === 'in:' ? 'channel' : 'user';

    // Check if there's a selected mention with matching prefix/type
    const hasMatchingMention = selectedMentions.some(
      m =>
        m.type === mentionType &&
        ((prefix === 'from:' && (!m.prefix || m.prefix === 'from:')) ||
          (prefix === 'assignee:' && m.prefix === 'assignee:') ||
          (prefix === 'in:' && m.prefix === 'in:')),
    );

    // If no matching mention found, this is an incomplete filter
    if (!hasMatchingMention) {
      return true;
    }
  }

  return false;
}
