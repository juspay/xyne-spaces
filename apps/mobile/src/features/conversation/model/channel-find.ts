import type { SearchResults } from '@/src/features/global-search/hooks/use-search-results';
import type { SearchScope } from '@/src/features/global-search/types';
import { isExactSearchQuery } from '@/src/features/global-search/utils/exact-search';
import {
  buildSearchRequest,
  type SearchRequest,
} from '@/src/features/global-search/utils/search-request';

import { clockLabel, dayMonthOf } from './message-time';

/**
 * The request "Find in this channel" sends: the global search's own request,
 * locked to this channel, so the two can never disagree about what matches.
 * There are no filters here, so quotes typed by hand are the only way to ask
 * for an exact phrase, and they last only as long as they are typed.
 */
export function channelFindRequest(query: string, scope: SearchScope): SearchRequest | null {
  return buildSearchRequest({
    tab: 'messages',
    query,
    chips: [],
    onlyMyChannels: false,
    includeBotMessages: false,
    exactMatch: isExactSearchQuery(query),
    scope,
  });
}

/** What the results area shows. */
export type FindView = 'hidden' | 'loading' | 'error' | 'empty' | 'results';

/**
 * Nothing until the first committed query, so the room stays readable while
 * the field is empty. A new query keeps the last one's rows on screen while it
 * loads, as the global search does, rather than flashing a spinner per word.
 */
export function findViewOf(
  query: string,
  status: SearchResults['status'],
  resultCount: number,
): FindView {
  if (query.trim().length === 0 || status === 'idle') return 'hidden';
  if (status === 'error') return 'error';
  if (resultCount > 0) return 'results';
  return status === 'loading' ? 'loading' : 'empty';
}

/** "1 message", "4 messages"; "25+ messages" while more pages are left to load. */
export function findCountLabel(count: number, hasMore: boolean): string {
  const noun = count === 1 && !hasMore ? 'message' : 'messages';
  return `${count}${hasMore ? '+' : ''} ${noun}`;
}

/**
 * A result's time, as a message row writes it ("9:49 am"). Results reach back
 * past today, where a bare clock would mislead, so older ones lead with the
 * day ("12 Oct, 9:49 am") and other years read as a date alone. Local time;
 * `nowMs` is passed in so the function is pure.
 */
export function findResultTime(timestampMs: number | undefined, nowMs: number): string {
  if (timestampMs === undefined || !Number.isFinite(timestampMs) || timestampMs <= 0) return '';
  const date = new Date(timestampMs);
  const now = new Date(nowMs);
  const day = dayMonthOf(date);

  if (date.getFullYear() !== now.getFullYear()) return `${day} ${date.getFullYear()}`;
  if (date.getMonth() === now.getMonth() && date.getDate() === now.getDate()) {
    return clockLabel(date);
  }
  return `${day}, ${clockLabel(date)}`;
}
