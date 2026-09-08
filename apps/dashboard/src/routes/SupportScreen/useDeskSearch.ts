import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { searchService } from '../../services/searchService';
import { parseAssigneeFilter } from '../../zero/queries';
import type { DisplaySearchResult, VespaSearchFilters } from '../../types/search';
import { extractVespaHighlights } from '../../utils/highlightTerms';

const DEBOUNCE_MS = 300;
const PAGE_LIMIT = 101;

const MAX_RANKED_CONVERSATIONS = 400;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 50;

/**
 * Toolbar filters pushed into the search query, so the ranked budget is spent on rows Zero
 * will keep. A filter belongs here only if its Vespa semantics are no STRICTER than Zero's:
 * a stricter one drops rows the list should show, and nothing downstream can recover them.
 */
interface DeskSearchFilters {
  assignedTo?: string[] | undefined;
  createdBy?: string[] | undefined;
  priority?: string[] | undefined;
  stageName?: string[] | undefined;
  userGroups?: string[] | undefined;
  aiCategory?: string[] | undefined;
  lastEmailAtStart?: number | undefined;
  lastEmailAtEnd?: number | undefined;
  createdAtStart?: number | undefined;
  createdAtEnd?: number | undefined;
  /** "category:value". Constrains both sources, not just ticket. */
  generatedTags?: string[] | undefined;
  /** `fieldId::value` tokens. */
  dynamicFieldValues?: string[] | undefined;
  dynamicFieldDateRanges?: Record<string, { start?: number; end?: number }> | undefined;
}

/** Ticket-source filters. Dropped whenever a mail-only operator narrows the search. */
type TicketSearchScope = Pick<
  VespaSearchFilters,
  | 'assignee'
  | 'from'
  | 'priority'
  | 'stage'
  | 'userGroups'
  | 'aiCategory'
  | 'isArchived'
  | 'createdAtStart'
  | 'createdAtEnd'
  | 'dynamicFieldValues'
  | 'dynamicFieldDateRanges'
>;

/** Filters both schemas carry, so they survive a narrowing to mail alone. */
type SharedSearchScope = Pick<
  VespaSearchFilters,
  'generatedTags' | 'lastEmailAtStart' | 'lastEmailAtEnd'
>;

interface UseDeskSearchParams {
  searchTerm: string;
  channelId: string | null;
  filters?: DeskSearchFilters;
}

interface UseDeskSearchResult {
  /** null when no search is active; [] while searching, or when nothing matched. */
  conversationIds: string[] | null;
  isSearching: boolean;
  /** A full page came back, so lower-ranked matches exist but were not fetched. */
  truncated: boolean;
  /** Widen the ranked window by one step. No-op unless `truncated`. */
  fetchMore: () => void;
  /**
   * Words to highlight: the free text typed (operators excluded) plus the fragments Vespa
   * marked in the hits, so a stemmed match is highlighted in the form the document uses.
   */
  terms: string[];
}

interface SearchOutcome {
  ids: string[];
  matchedTerms: string[];
  truncated: boolean;
}

// Deliberately no in-flight coalescing: a promise shared across callers would inherit the
// first caller's abort signal.
const resultCache = new Map<string, { expiresAt: number; value: SearchOutcome }>();

/** Matched conversations in Vespa's relevance order — array position is the rank. */
const searchConversations = async (
  filters: VespaSearchFilters,
  offset: number,
  signal: AbortSignal,
): Promise<DisplaySearchResult[]> => {
  const { results } = await searchService.vespaSearch(
    { ...filters, limit: PAGE_LIMIT, offset },
    signal,
  );
  return results;
};

interface ParsedQuery {
  text: string;
  fromEmail?: string;
  toEmail?: string;
  ccEmail?: string;
  bccEmail?: string;
  filename?: string;
}

/**
 * A ticket id, `CODE-0042`. The default tokenizer splits it at the hyphen, matching every
 * ticket in the project and scoring the right one no higher; quoting selects the backend's
 * exact-phrase mode, where the id survives as one term and unified's id_boost ranks it first.
 */
const TICKET_ID_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** Operators that constrain `mail` only, so their presence drops the `ticket` source. */
const MAIL_ONLY_OPERATORS = ['fromEmail', 'toEmail', 'ccEmail', 'bccEmail', 'filename'] as const;

const OPERATOR_KEYS: Record<string, keyof ParsedQuery> = {
  from: 'fromEmail',
  to: 'toEmail',
  cc: 'ccEmail',
  bcc: 'bccEmail',
  filename: 'filename',
};

const parseQuery = (raw: string): ParsedQuery => {
  const collected: Record<string, string[]> = {};

  const text = raw
    .replace(
      /(^|\s)(from|to|cc|bcc|filename):(\S+)/gi,
      (_match, _lead, operator: string, value: string) => {
        const key = OPERATOR_KEYS[operator.toLowerCase()];
        if (key) (collected[key] ??= []).push(value);
        return ' ';
      },
    )
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text,
    ...Object.fromEntries(
      Object.entries(collected).map(([key, values]) => [key, values.join(',')]),
    ),
  };
};

const toTicketSearchFilters = (filters: DeskSearchFilters | undefined): TicketSearchScope => {
  // Unconditional: archived tickets would otherwise fill the ranked prefix and be discarded
  // by Zero, which filters them out in every folder.
  const base: TicketSearchScope = { isArchived: false };
  if (!filters) return base;

  // "Unassigned" and the invert marker are Zero-side sentinels with no Vespa equivalent, so
  // pushing them as ids would match nothing.
  const assignee = filters.assignedTo ? parseAssigneeFilter(filters.assignedTo) : undefined;
  const pushableAssignees =
    assignee && !assignee.inverted && !assignee.includeUnassigned ? assignee.ids : [];

  return {
    ...base,
    ...(pushableAssignees.length > 0 ? { assignee: pushableAssignees.join(',') } : {}),
    ...(filters.createdBy?.length ? { from: filters.createdBy.join(',') } : {}),
    ...(filters.priority?.length ? { priority: filters.priority.join(',') } : {}),
    ...(filters.stageName?.length ? { stage: filters.stageName.join(',') } : {}),
    ...(filters.userGroups?.length ? { userGroups: filters.userGroups.join(',') } : {}),
    ...(filters.aiCategory?.length ? { aiCategory: filters.aiCategory.join(',') } : {}),
    ...(filters.dynamicFieldValues?.length
      ? { dynamicFieldValues: filters.dynamicFieldValues }
      : {}),
    ...(filters.dynamicFieldDateRanges
      ? { dynamicFieldDateRanges: filters.dynamicFieldDateRanges }
      : {}),
    ...(filters.createdAtStart !== undefined ? { createdAtStart: filters.createdAtStart } : {}),
    ...(filters.createdAtEnd !== undefined ? { createdAtEnd: filters.createdAtEnd } : {}),
  };
};

const toSharedSearchFilters = (filters: DeskSearchFilters | undefined): SharedSearchScope => ({
  ...(filters?.generatedTags?.length ? { generatedTags: filters.generatedTags.join(',') } : {}),
  ...(filters?.lastEmailAtStart !== undefined
    ? { lastEmailAtStart: filters.lastEmailAtStart }
    : {}),
  ...(filters?.lastEmailAtEnd !== undefined ? { lastEmailAtEnd: filters.lastEmailAtEnd } : {}),
});

const runSearch = async (
  channelId: string,
  parsed: ParsedQuery,
  ticketScope: TicketSearchScope,
  sharedScope: SharedSearchScope,
  offset: number,
  signal: AbortSignal,
): Promise<SearchOutcome> => {
  const { text, ...operators } = parsed;
  const hasMailOnlyOperator = MAIL_ONLY_OPERATORS.some(key => !!parsed[key]);

  // One query over both sources rather than one each: concatenating two ranked lists would
  // put every mail match ahead of every ticket-only match whatever their relevance.
  // A mail-only operator drops `ticket`, which would otherwise match on text alone and
  // ignore the operator entirely.
  const apps = hasMailOnlyOperator ? 'mail' : 'mail,ticket';
  const type = hasMailOnlyOperator ? 'emails' : 'emails,tickets';

  const results = await searchConversations(
    {
      in: channelId,
      apps,
      type,
      // '*' drops the text clause server-side, leaving a pure operator filter.
      query: text ? (TICKET_ID_PATTERN.test(text) ? `"${text}"` : text) : '*',
      ...operators,
      ...sharedScope,
      ...(hasMailOnlyOperator ? {} : ticketScope),
    },
    offset,
    signal,
  );

  // Grouping already collapsed each conversation to one document; dedupe defensively.
  const seen = new Set<string>();
  const ids: string[] = [];
  const matchedTerms = new Set<string>();
  for (const result of results) {
    const conversationId = result.searchContext?.conversationId;
    if (!conversationId || seen.has(conversationId)) continue;
    seen.add(conversationId);
    ids.push(conversationId);
    for (const field of [result.title, result.subtitle, result.context]) {
      for (const term of extractVespaHighlights(field)) matchedTerms.add(term.toLowerCase());
    }
  }

  return {
    ids,
    matchedTerms: [...matchedTerms],
    truncated: results.length >= PAGE_LIMIT && offset + PAGE_LIMIT < MAX_RANKED_CONVERSATIONS,
  };
};

/**
 * Text search over a desk channel, returning the matched conversations in rank order.
 * One query spans mail and ticket, grouped by threadId so each conversation appears once.
 *
 * Vespa is not authoritative: Zero re-applies every filter to the ids this returns, so the
 * two can never disagree about what the user is allowed to see.
 */
export function useDeskSearch({
  searchTerm,
  channelId,
  filters,
}: UseDeskSearchParams): UseDeskSearchResult {
  const [conversationIds, setConversationIds] = useState<string[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [matchedTerms, setMatchedTerms] = useState<string[]>([]);

  // Callers rebuild `filters` every render, so key the effect on the scope's value.
  const ticketScopeKey = JSON.stringify(toTicketSearchFilters(filters));
  const ticketScope = useMemo<TicketSearchScope>(
    () => JSON.parse(ticketScopeKey) as TicketSearchScope,
    [ticketScopeKey],
  );

  const sharedScopeKey = JSON.stringify(toSharedSearchFilters(filters));
  const sharedScope = useMemo<SharedSearchScope>(
    () => JSON.parse(sharedScopeKey) as SharedSearchScope,
    [sharedScopeKey],
  );

  // The offset is stored with the search it belongs to and read back as 0 under any other
  // key, so a new query starts from page one in the same render — an effect-driven reset
  // would let the search effect fire once with the stale offset first.
  const searchKey = JSON.stringify([searchTerm, channelId, ticketScopeKey, sharedScopeKey]);
  const [paging, setPaging] = useState({ key: searchKey, offset: 0 });
  const pageOffset = paging.key === searchKey ? paging.offset : 0;

  // Read through a ref so `fetchMore` keeps one identity: the list re-runs its request-more
  // effect when the callback changes, which would widen a new search before its first page.
  const searchKeyRef = useRef(searchKey);
  searchKeyRef.current = searchKey;
  const fetchMore = useCallback(() => {
    const key = searchKeyRef.current;
    setPaging(prev => ({ key, offset: (prev.key === key ? prev.offset : 0) + PAGE_LIMIT }));
  }, []);

  useEffect(() => {
    const parsed = parseQuery(searchTerm);
    // An operator with no free text is still a search ("cc:alice@x.com" on its own).
    const hasOperator = MAIL_ONLY_OPERATORS.some(key => !!parsed[key]);
    if ((!parsed.text && !hasOperator) || !channelId) {
      setConversationIds(null);
      setMatchedTerms([]);
      setIsSearching(false);
      setTruncated(false);
      return;
    }

    const cacheKey = JSON.stringify([
      channelId,
      parsed,
      ticketScopeKey,
      sharedScopeKey,
      pageOffset,
    ]);
    const cached = resultCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      setConversationIds(cached.value.ids);
      setMatchedTerms(cached.value.matchedTerms);
      setTruncated(cached.value.truncated);
      setIsSearching(false);
      return;
    }

    // Narrow to nothing so no unfiltered row shows while the request is in flight. Skipped
    // when only the window widened — those ids are a prefix of what is coming back.
    if (pageOffset === 0) {
      setConversationIds([]);
      setTruncated(false);
    }
    setIsSearching(true);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      runSearch(channelId, parsed, ticketScope, sharedScope, pageOffset, controller.signal)
        .then(outcome => {
          // Expired entries are never evicted on read, so drop the lot at the cap.
          if (resultCache.size >= CACHE_MAX_ENTRIES) resultCache.clear();
          resultCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: outcome });
          if (controller.signal.aborted) return;
          // Page 0 replaces; later pages append, preserving Vespa's rank order across pages.
          setConversationIds(prev =>
            pageOffset === 0 || prev === null ? outcome.ids : [...prev, ...outcome.ids],
          );
          setMatchedTerms(prev =>
            pageOffset === 0
              ? outcome.matchedTerms
              : [...new Set([...prev, ...outcome.matchedTerms])],
          );
          setTruncated(outcome.truncated);
          setIsSearching(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setConversationIds([]);
          setMatchedTerms([]);
          setTruncated(false);
          setIsSearching(false);
        });
    }, DEBOUNCE_MS);

    return (): void => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, channelId, ticketScope, ticketScopeKey, sharedScope, sharedScopeKey, pageOffset]);

  const terms = useMemo(() => {
    const { text } = parseQuery(searchTerm);
    const typed = text.split(/\s+/).filter(word => word.length > 1);
    return [...new Set([...typed, ...matchedTerms])];
  }, [searchTerm, matchedTerms]);

  return { conversationIds, isSearching, truncated, fetchMore, terms };
}

export default useDeskSearch;
