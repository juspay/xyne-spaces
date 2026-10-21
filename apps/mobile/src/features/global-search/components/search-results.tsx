import { useEffect, useMemo, type ReactElement } from 'react';

import type { SearchState } from '../hooks/use-search-state';
import { buildSearchRequest, categoryForTab } from '../utils/search-request';
import type { SearchFilterChip, SearchScope } from '../types';
import { ChannelResults, ChatResults } from './results/local-results';
import { CallResults, HitResults } from './results/remote-results';
import { FromSuggestions, InSuggestions } from './results/suggestions';
import type { ListChrome } from './search-list';

export type SearchResultsProps = ListChrome & {
  state: SearchState;
  /** Locks the search to one conversation. Null for ordinary global search. */
  scope: SearchScope | null;
  onPickFilter: (chip: SearchFilterChip) => void;
  /** Blurs the search field before a result is opened on top of it. */
  onLeave: () => void;
};

/**
 * Picks the one list for what is on screen. Each list asks for its own data, so a
 * tab that is not showing fetches and searches nothing.
 */
export function SearchResults({
  state,
  scope,
  onPickFilter,
  onLeave,
  ...chrome
}: SearchResultsProps): ReactElement {
  const { tab, query, chips, onlyMyChannels, trigger } = state;
  const { scrollOffset } = chrome;
  const showsSuggestions = trigger !== null;

  // Each list below is its own scroll view, so the offset the last one left behind
  // would keep the filter row collapsed over a list that is back at the top.
  useEffect(() => {
    scrollOffset.value = 0;
  }, [query, scrollOffset, showsSuggestions, tab]);

  const request = useMemo(
    () => buildSearchRequest({ tab, query, chips, onlyMyChannels, scope }),
    [chips, onlyMyChannels, query, scope, tab],
  );

  if (trigger) {
    return trigger.kind === 'from' ? (
      <FromSuggestions trigger={trigger} onPick={onPickFilter} {...chrome} />
    ) : (
      <InSuggestions trigger={trigger} onPick={onPickFilter} {...chrome} />
    );
  }

  const category = scope ? 'messages' : categoryForTab(tab);
  // A locked scope narrows the request but is not something the user asked for.
  const hasQuery = query.length > 0 || chips.length > 0;

  if (category === 'calls') {
    return <CallResults request={request} query={query} hasQuery={hasQuery} {...chrome} />;
  }

  if (category) {
    return (
      // Keyed so each category gets a fresh list rather than the last one's scroll position.
      <HitResults
        key={category}
        category={category}
        request={request}
        query={query}
        hasQuery={hasQuery}
        scope={scope}
        onLeave={onLeave}
        {...chrome}
      />
    );
  }

  // Dashboard parity: filters with no text search messages only, so the on-device
  // lists have nothing to show.
  const browse = query.length > 0 || chips.length === 0;

  return tab === 'channels' ? (
    <ChannelResults
      query={query}
      browse={browse}
      hasQuery={hasQuery}
      onLeave={onLeave}
      {...chrome}
    />
  ) : (
    <ChatResults query={query} browse={browse} hasQuery={hasQuery} onLeave={onLeave} {...chrome} />
  );
}
