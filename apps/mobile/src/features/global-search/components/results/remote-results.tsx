import { useCallback, useMemo, type ReactElement } from 'react';

import { CallLogItem } from '@/src/components/call-log';
import type { DisplaySearchResult } from '@/src/types/search';
import { useCallResults } from '../../hooks/use-call-results';
import { useSearchNavigation } from '../../hooks/use-search-navigation';
import { useSearchResults } from '../../hooks/use-search-results';
import type { CallSearchResultItem } from '../../utils/map-vespa-call-result';
import type { SearchCategory, SearchRequest } from '../../utils/search-request';
import type { SearchScope } from '../../types';
import { SearchResultRow } from '../rows/search-result-row';
import { SearchList, type EmptyCopy, type ListChrome } from '../search-list';

export type HitCategory = Exclude<SearchCategory, 'calls'>;

const HIT_COPY: Record<HitCategory, { label: string; empty: EmptyCopy }> = {
  messages: {
    label: 'Messages',
    empty: {
      idleTitle: 'Search messages',
      idleSubtitle: 'Find messages across your DMs and channels.',
      emptyTitle: 'No matching messages',
      emptySubtitle: 'Try another keyword.',
    },
  },
  tickets: {
    label: 'Tickets',
    empty: {
      idleTitle: 'Search tickets',
      idleSubtitle: 'Type to search tickets across your workspace.',
      emptyTitle: 'No matching tickets',
      emptySubtitle: 'Try a different ticket id or keyword.',
    },
  },
  files: {
    label: 'Files',
    empty: {
      idleTitle: 'Search files',
      idleSubtitle: 'Type to search files and attachments.',
      emptyTitle: 'No matching files',
      emptySubtitle: 'Try a different file name or keyword.',
    },
  },
};

type RemoteProps = ListChrome & {
  request: SearchRequest | null;
  query: string;
  hasQuery: boolean;
};

export function HitResults({
  category,
  request,
  query,
  hasQuery,
  scope,
  onLeave,
  ...chrome
}: RemoteProps & {
  category: HitCategory;
  scope: SearchScope | null;
  onLeave: () => void;
}): ReactElement {
  const { openResult } = useSearchNavigation(onLeave);
  const results = useSearchResults(request);
  const { label } = HIT_COPY[category];

  const sections = useMemo(
    () => [{ id: category, title: `${label} (${results.data.length})`, items: results.data }],
    [category, label, results.data],
  );

  const renderItem = useCallback(
    (item: DisplaySearchResult) => (
      <SearchResultRow result={item} query={query} onPress={openResult} />
    ),
    [openResult, query],
  );

  const empty = useMemo(
    (): EmptyCopy =>
      scope
        ? {
            ...HIT_COPY[category].empty,
            idleTitle: `Search messages in ${scope.label}`,
            idleSubtitle: 'Only this conversation is searched.',
          }
        : HIT_COPY[category].empty,
    [category, scope],
  );

  return (
    <SearchList
      {...chrome}
      sections={sections}
      status={results}
      hasQuery={hasQuery}
      renderItem={renderItem}
      itemKey={hitKey}
      estimatedItemSize={72}
      empty={empty}
      skeletonTitle={label}
    />
  );
}

const CALLS_EMPTY: EmptyCopy = {
  idleTitle: 'Search calls',
  idleSubtitle: 'Find calls by participant, channel, or title.',
  emptyTitle: 'No matching calls',
  emptySubtitle: 'Try a different name or keyword.',
};

export function CallResults({ request, query, hasQuery, ...chrome }: RemoteProps): ReactElement {
  const results = useSearchResults(request);

  // Mapped outside the request, so a user or channel that syncs late relabels the rows
  // already on screen instead of needing another search.
  const calls = useCallResults(results.data);

  const sections = useMemo(
    () => [{ id: 'calls', title: `Calls (${calls.length})`, items: calls }],
    [calls],
  );

  const renderItem = useCallback(
    (item: CallSearchResultItem) => (
      <CallLogItem
        call={item.call}
        searchQuery={query}
        {...(item.highlightTitle ? { highlightTitle: item.highlightTitle } : {})}
      />
    ),
    [query],
  );

  return (
    <SearchList
      {...chrome}
      sections={sections}
      status={results}
      hasQuery={hasQuery}
      renderItem={renderItem}
      itemKey={callKey}
      estimatedItemSize={76}
      empty={CALLS_EMPTY}
      skeletonVariant='call'
      skeletonTitle='Calls'
    />
  );
}

function hitKey(item: DisplaySearchResult): string {
  return item.id;
}

function callKey(item: CallSearchResultItem): string {
  return item.call.id;
}
