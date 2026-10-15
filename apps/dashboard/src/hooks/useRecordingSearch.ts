import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChipType, TabType } from '../components/Chat/ChatDirectory/ChannelCommandMenu.types';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import type { OatsRecordingEntry, OatsRecordingScope } from './usePaginatedOatsRecordings';
import { useSearchMetrics } from './useSearchMetrics';
import { useSelf } from './useUsers';

// `unified` scopes file docs to fileName only, which would skip the transcript itself.
const RECORDING_SEARCH_RANK_PROFILE = 'default_native';
// oatsRecordingsByIds takes at most this many ids.
const MAX_SEARCH_HITS = 1000;
// Pages a search may load on its own while every loaded match is filtered out.
const MAX_AUTO_LOAD_PAGES = 5;

export interface RecordingSearch {
  /** Text, an owner or a label is set, so the screen lists matches instead of its pages. */
  isSearchActive: boolean;
  /** Matches narrowed to the active tab, in relevance order. */
  recordings: OatsRecordingEntry[];
  /** Every match loaded so far, before the tab narrowing. */
  matches: OatsRecordingEntry[];
  isSearching: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  /** Loads the next page of matches; a no-op when none is left or one is loading. */
  loadMore: () => void;
  error: string | null;
  /** Identifies the current search (text, owners, labels). */
  searchKey: string;
  /** Hits loaded so far for the current search. */
  hitCount: number;
  onSearchChange: (text: string, ownerIds: string[], labels: string[]) => void;
}

/**
 * Recordings search. Same search hook as Call History, on its Recordings tab: owners as
 * `from:` chips, labels as the `tags` filter. Vespa ranks transcript docs (docId = call id);
 * the rows come from Zero, so a match renders and acts exactly like a row of the list.
 */
export function useRecordingSearch(activeListTab: OatsRecordingScope): RecordingSearch {
  const currentUser = useSelf();
  const [searchText, setSearchText] = useState('');
  const [searchOwnerIds, setSearchOwnerIds] = useState<string[]>([]);
  const [searchLabels, setSearchLabels] = useState<string[]>([]);
  const {
    searchResults: searchHits,
    isSearching: isSearchRunning,
    isSearchPending,
    searchError,
    paginationState: searchPagination,
    isLoadingMore,
    loadMore: loadMoreSearchHits,
    setText: setSearchQueryText,
    setSelectedMentions: setSearchMentions,
    setStructuredFilters: setSearchStructuredFilters,
    setActiveTab: setSearchTab,
    setRankProfile: setSearchRankProfile,
  } = useSearchMetrics();
  useEffect(() => {
    setSearchTab(TabType.RECORDING);
    setSearchRankProfile(RECORDING_SEARCH_RANK_PROFILE);
  }, [setSearchTab, setSearchRankProfile]);
  const isSearchActive =
    searchText.trim().length > 0 || searchOwnerIds.length > 0 || searchLabels.length > 0;
  const searchHitIds = useMemo(
    () => (isSearchActive ? searchHits.slice(0, MAX_SEARCH_HITS).map(hit => hit.id) : []),
    [isSearchActive, searchHits],
  );
  const [searchHitRows, searchHitRowsDetails] = useCachedQuery(
    queries.oatsRecordingsByIds({ ids: searchHitIds }),
    { enabled: searchHitIds.length > 0 },
  );
  // Matching recordings in Vespa's relevance order, like the calls screen.
  const matches = useMemo<OatsRecordingEntry[]>(() => {
    if (searchHitIds.length === 0 || !searchHitRows) return [];
    const rowsById = new Map(
      (searchHitRows as readonly OatsRecordingEntry[]).map(row => [row.id, row]),
    );
    return searchHitIds.flatMap(id => rowsById.get(id) ?? []);
  }, [searchHitIds, searchHitRows]);
  const isSearching =
    isSearchPending ||
    isSearchRunning ||
    // Hits are known but their rows are still syncing from Zero.
    (searchHitIds.length > 0 && searchHitRowsDetails.type !== 'complete' && matches.length === 0);
  const hasMore =
    searchPagination[TabType.RECORDING].hasMore && searchHits.length < MAX_SEARCH_HITS;
  // Vespa returns every recording the viewer can open, public ones included. Keep only what
  // the active tab lists, like the list itself: Created = own, Shared = a live share reaches
  // the viewer (`shares` is pre-filtered to those), All = both, so not other public ones.
  const recordings = useMemo(() => {
    const isOwn = (recording: OatsRecordingEntry): boolean =>
      recording.createdByUserId === currentUser?.id;
    const isSharedWithMe = (recording: OatsRecordingEntry): boolean =>
      !isOwn(recording) && (recording.shares?.length ?? 0) > 0;
    return matches.filter(recording =>
      activeListTab === 'created'
        ? isOwn(recording)
        : activeListTab === 'shared'
          ? isSharedWithMe(recording)
          : isOwn(recording) || isSharedWithMe(recording),
    );
  }, [activeListTab, currentUser?.id, matches]);
  const loadMore = useCallback((): void => {
    if (hasMore && !isLoadingMore) void loadMoreSearchHits();
  }, [hasMore, isLoadingMore, loadMoreSearchHits]);
  const onSearchChange = useCallback(
    (text: string, ownerIds: string[], labels: string[]): void => {
      setSearchText(text);
      setSearchOwnerIds(ownerIds);
      setSearchLabels(labels);
      setSearchQueryText(text);
      setSearchMentions(ownerIds.map(id => ({ id, type: ChipType.USER, prefix: 'from:' })));
      // On transcripts the shared `tags` filter matches the confirmed label slugs.
      setSearchStructuredFilters(labels.length > 0 ? { tags: labels.join(',') } : {});
    },
    [setSearchQueryText, setSearchMentions, setSearchStructuredFilters],
  );

  return {
    isSearchActive,
    recordings,
    matches,
    isSearching,
    isLoadingMore,
    hasMore,
    loadMore,
    error: searchError,
    searchKey: JSON.stringify([searchText, searchOwnerIds, searchLabels]),
    hitCount: searchHits.length,
    onSearchChange,
  };
}

/**
 * Search pages its hits, and the screen's tab/date/label filters run on the loaded ones, so a
 * page can leave nothing to show while more pages match, and with no list there's no scroll
 * to load them. Pull the next page instead: once per hit count of a search (a failed load
 * leaves the count, so it can't loop), and at most MAX_AUTO_LOAD_PAGES times per search.
 * Returns true while that load is about to start.
 */
export function useAutoLoadFilteredOutSearchPage(
  search: RecordingSearch,
  visibleCount: number,
): boolean {
  const { isSearchActive, isSearching, hasMore, isLoadingMore, searchKey, hitCount, loadMore } =
    search;
  const [autoLoad, setAutoLoad] = useState<{
    searchKey: string;
    hitCount: number;
    pages: number;
  } | null>(null);
  const autoLoadedPages = autoLoad?.searchKey === searchKey ? autoLoad.pages : 0;
  const shouldAutoLoad =
    isSearchActive &&
    !isSearching &&
    visibleCount === 0 &&
    hasMore &&
    !isLoadingMore &&
    autoLoadedPages < MAX_AUTO_LOAD_PAGES &&
    !(autoLoad?.searchKey === searchKey && autoLoad.hitCount === hitCount);
  useEffect(() => {
    if (!shouldAutoLoad) return;
    setAutoLoad({ searchKey, hitCount, pages: autoLoadedPages + 1 });
    loadMore();
  }, [shouldAutoLoad, searchKey, hitCount, autoLoadedPages, loadMore]);
  return shouldAutoLoad;
}
