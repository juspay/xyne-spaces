import type { VespaSearchFilters } from '@/src/types/search';
import { buildVespaSearchParams, sanitizeSearchQuery } from '@/src/utils/search';
import type { SearchFilterChip, SearchFilterPrefix, SearchScope } from '../types';
import { toSearchQuery } from './exact-search';
import {
  DEFAULT_STRUCTURED_FILTERS,
  hasStructuredFilterInput,
  type StructuredSearchFilters,
} from './filter-model';
import { effectiveInputsForScope } from './scope';
import type { GlobalSearchTab } from './search-tabs';

/** Matches dashboard `BACKEND_RESULTS_LIMIT` — per category, not shared across them. */
const RESULTS_LIMIT = 25;

export type SearchCategory = 'messages' | 'tickets' | 'files' | 'calls';

export type SearchRequest = {
  category: SearchCategory;
  freeText: string;
  chips: readonly SearchFilterChip[];
  structured: StructuredSearchFilters;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
  exactMatch: boolean;
};

export type SearchRequestInput = {
  tab: GlobalSearchTab;
  /** Debounced text with any `from:` / `in:` operator already stripped. */
  query: string;
  /** Filters the user picked. Never the locked scope. */
  chips: readonly SearchFilterChip[];
  structured?: StructuredSearchFilters;
  onlyMyChannels: boolean;
  includeBotMessages: boolean;
  exactMatch: boolean;
  scope: SearchScope | null;
};

/** Chats and Channels are searched on-device and never reach the backend. */
const CATEGORY_FOR_TAB: Record<GlobalSearchTab, SearchCategory | null> = {
  messages: 'messages',
  tickets: 'tickets',
  files: 'files',
  calls: 'calls',
  chats: null,
  channels: null,
};

/** Each category is fetched with its own `type` + `apps`, as dashboard does. */
const CATEGORY_WIRE: Record<SearchCategory, { type: string; apps: string }> = {
  messages: { type: 'messages', apps: 'chat' },
  tickets: { type: 'tickets', apps: 'ticket' },
  files: { type: 'files', apps: 'file' },
  calls: { type: 'calls', apps: 'call' },
};

export function categoryForTab(tab: GlobalSearchTab): SearchCategory | null {
  return CATEGORY_FOR_TAB[tab];
}

/**
 * The request for what is on screen, or `null` when nothing should be sent.
 * Every rule about *whether* to search lives here.
 */
export function buildSearchRequest({
  tab,
  query,
  chips,
  structured = DEFAULT_STRUCTURED_FILTERS,
  onlyMyChannels,
  includeBotMessages,
  exactMatch,
  scope,
}: SearchRequestInput): SearchRequest | null {
  // Scoped search is a single messages surface with no tabs.
  const category = scope ? 'messages' : categoryForTab(tab);
  if (!category) return null;

  const freeText = query.trim();
  // A locked scope narrows the request; it is not something the user asked for.
  // Mode toggles alone do not count either: alone they would mean "every hit in
  // every channel I am in" / "every bot message".
  const hasUserInput = scope
    ? freeText.length > 0
    : freeText.length > 0 || chips.length > 0 || hasStructuredFilterInput(structured);
  if (!hasUserInput) return null;

  return {
    category,
    freeText,
    structured,
    ...effectiveInputsForScope(
      { chips, onlyMyChannels, includeBotMessages, exactMatch },
      scope,
    ),
  };
}

/** Comma-joined chip ids for one prefix — the backend ORs them. */
function chipIds(
  chips: readonly SearchFilterChip[],
  prefix: SearchFilterPrefix,
): string | undefined {
  const ids = chips.filter(chip => chip.prefix === prefix).map(chip => chip.id);
  return ids.length > 0 ? ids.join(',') : undefined;
}

function entityIds(entities: readonly { id: string }[]): string | undefined {
  return entities.length > 0 ? entities.map(entity => entity.id).join(',') : undefined;
}

function joinList(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(',') : undefined;
}

/** Structured date → Vespa `on` / `after`+`before` / `range`. */
function dateParams(structured: StructuredSearchFilters): Partial<VespaSearchFilters> {
  const { dateRange, after, before } = structured;
  if (after && before && after === before) return { on: after };
  if (after || before) {
    return {
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
    };
  }
  if (dateRange) return { range: dateRange };
  return {};
}

export function buildSearchFilters(request: SearchRequest): VespaSearchFilters {
  const {
    category,
    freeText,
    chips,
    structured = DEFAULT_STRUCTURED_FILTERS,
    onlyMyChannels,
    includeBotMessages,
    exactMatch,
  } = request;
  const from = chipIds(chips, 'from:');
  const inside = chipIds(chips, 'in:');
  const withUsers = entityIds(structured.withUsers);
  const sanitized = sanitizeSearchQuery(freeText);

  const hasEntityFilters = Boolean(
    from ||
      inside ||
      withUsers ||
      structured.assignees.length ||
      structured.mentionUsers.length ||
      structured.mentionChannels.length ||
      structured.mentionGroups.length ||
      structured.boards.length ||
      structured.tags.length ||
      structured.entities.length ||
      structured.statuses.length ||
      structured.fromEmails.length ||
      structured.toEmails.length ||
      structured.priority ||
      structured.dateRange ||
      structured.after ||
      structured.before,
  );

  const filters: VespaSearchFilters = {
    query: toSearchQuery(sanitized, exactMatch),
    limit: RESULTS_LIMIT,
    offset: 0,
    presentationSummary: 'lean',
    ...CATEGORY_WIRE[category],
  };

  // Call search filters on participants via `with` → `withUser`. Message search
  // uses `from:` for senders and structured `withUsers` for the With filter.
  if (from) {
    if (category === 'calls') filters.with = from;
    else filters.from = from;
  }
  if (inside) filters.in = inside;
  if (withUsers && (category === 'messages' || (category === 'calls' && !from))) {
    filters.with = withUsers;
  }

  const mentions = entityIds(structured.mentionUsers);
  const channelMentions = entityIds(structured.mentionChannels);
  const groupMentions = entityIds(structured.mentionGroups);
  const assignee = entityIds(structured.assignees);
  const board = entityIds(structured.boards);
  const tags = joinList(structured.tags);
  const entity = joinList(structured.entities);
  const status = joinList(structured.statuses);
  const fromEmail = joinList(structured.fromEmails);
  const toEmail = joinList(structured.toEmails);

  if (mentions) filters.mentions = mentions;
  if (channelMentions) filters.channelMentions = channelMentions;
  if (groupMentions) filters.groupMentions = groupMentions;
  if (assignee) filters.assignee = assignee;
  if (structured.priority) filters.priority = structured.priority;
  if (board) filters.board = board;
  if (tags) filters.tags = tags;
  if (entity) filters.entity = entity;
  if (status) filters.status = status;
  if (fromEmail) filters.fromEmail = fromEmail;
  if (toEmail) filters.toEmail = toEmail;

  Object.assign(filters, dateParams(structured));

  // `in:` carries an implicit `false` so the backend does not re-narrow an explicit
  // channel list to joined channels. The toggle, when on, overrides it.
  if (onlyMyChannels) filters.onlyMyChannels = true;
  else if (inside) filters.onlyMyChannels = false;

  // Bot inclusion only applies to message search (dashboard `appliesTo: isMessageType`).
  if (category === 'messages') filters.includeBotMessages = includeBotMessages;

  // Show archived inverts excludeArchived on tickets (desk not a mobile tab).
  if (category === 'tickets') filters.excludeArchived = !structured.showArchived;

  if (!freeText && hasEntityFilters) filters.filterOnly = true;

  return filters;
}

/**
 * The query string as sent. Also the request's identity: two requests that would
 * produce the same call produce equal params.
 */
export function toSearchParams(request: SearchRequest): Record<string, string> {
  return buildVespaSearchParams(buildSearchFilters(request));
}
