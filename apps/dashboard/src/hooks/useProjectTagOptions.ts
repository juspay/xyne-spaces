import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { useDebouncedValue } from './useDebouncedValue';
import { useVespaTagSearch } from './useVespaTagSearch';

const PAGE_SIZE = 20;
// Ceiling for autoLoadAll, so a pathological catalog cannot spin forever.
const AUTO_LOAD_MAX_PAGES = 100;

interface UseProjectTagOptionsParams {
  /**
   * The project whose tag catalog to offer. Tag-ATTACH dropdowns must be scoped to
   * the ticket's own project: the mutators create with `projectId: ticket.projectId`,
   * so offering another project's tag silently copies it into this one. (Tag
   * FILTER dropdowns are different — they should span the whole view — and keep
   * using the screen-level list.)
   */
  projectId?: string | undefined;
  /**
   * Gate the queries on the dropdown actually being open. Components like
   * LabelPicker run their body for every row in the table, so without this every
   * row would fire a Zero query on mount.
   */
  enabled?: boolean | undefined;
  /**
   * Drain every page instead of waiting for a scroll. For callers that render the
   * catalog somewhere with no scroll container to hang loadMore off — a report
   * filter multi-select, a bulk-action list — where a silently truncated list is
   * worse than the extra round trips. Bounded by AUTO_LOAD_MAX_PAGES.
   */
  autoLoadAll?: boolean | undefined;
}

interface UseProjectTagOptionsResult {
  availableTags: string[];
  /** Accumulated rows, for callers that need the tag id and not just the name. */
  tagRows: Array<{ name: string; id: string }>;
  onSearch: (query: string) => void;
  hasMore: boolean;
  loadMore: () => void;
}

export const useProjectTagOptions = ({
  projectId,
  enabled = true,
  autoLoadAll = false,
}: UseProjectTagOptionsParams): UseProjectTagOptionsResult => {
  const [searchQuery, setSearchQuery] = useState('');
  const [cursor, setCursor] = useState<{ name: string; id: string } | null>(null);
  const [accumulated, setAccumulated] = useState<Array<{ name: string; id: string }>>([]);
  const [hasMoreZeroTags, setHasMoreZeroTags] = useState(true);
  const autoPagesRef = useRef(0);

  const active = enabled && !!projectId;
  const isSearching = !!searchQuery.trim();

  // Reset paging whenever the corpus or the query changes.
  useEffect(() => {
    setCursor(null);
    setAccumulated([]);
    setHasMoreZeroTags(true);
    autoPagesRef.current = 0;
  }, [projectId, searchQuery]);

  const [page, pageDetails] = useCachedQuery(
    queries.projectTagsByProjectId({
      projectId: projectId ?? '',
      limit: PAGE_SIZE,
      start: cursor,
    }),
    { enabled: active && !isSearching },
  );
  useEffect(() => {
    if (pageDetails.type !== 'complete') return;

    if (!page || page.length === 0) {
      if (cursor !== null) setHasMoreZeroTags(false);
      return;
    }

    if (page.length < PAGE_SIZE) setHasMoreZeroTags(false);

    setAccumulated(prev => {
      const seen = new Set(prev.map(t => t.id));
      return [...prev, ...page.filter(t => !seen.has(t.id))];
    });
  }, [page, cursor, pageDetails.type]);

  // Vespa fetches immediately on change, so debounce the raw input.
  const debouncedQuery = useDebouncedValue(searchQuery, 250);
  const {
    tags: vespaTags,
    hasMore: hasMoreVespaTags,
    loadMore: loadMoreVespaTags,
  } = useVespaTagSearch({
    projectIds: projectId ? [projectId] : undefined,
    searchQuery: debouncedQuery,
    enabled: active && !!debouncedQuery.trim(),
    limit: PAGE_SIZE,
  });

  const availableTags = useMemo(() => {
    // localeCompare, not the default .sort(): the default orders by UTF-16 code
    // unit, putting every uppercase tag above every lowercase one.
    const zeroTags = Array.from(new Set(accumulated.map(t => t.name))).sort((a, b) =>
      a.localeCompare(b),
    );

    if (!isSearching) return zeroTags;
    if (vespaTags.length > 0) return vespaTags;

    const lower = searchQuery.toLowerCase();
    return zeroTags.filter(t => t.toLowerCase().includes(lower));
  }, [accumulated, isSearching, vespaTags, searchQuery]);

  const loadMore = useCallback(() => {
    // Two paging sources matching the two result sources.
    if (isSearching) {
      loadMoreVespaTags();
      return;
    }
    if (!hasMoreZeroTags) return;
    const last = accumulated[accumulated.length - 1];
    if (last) setCursor({ name: last.name, id: last.id });
  }, [isSearching, loadMoreVespaTags, hasMoreZeroTags, accumulated]);

  // Drain remaining pages for callers with nowhere to hang a scroll handler.
  // Guarded on a settled query so it advances one page at a time rather than
  // firing repeatedly against a cursor that has not moved yet.
  useEffect(() => {
    if (!autoLoadAll || isSearching) return;
    if (pageDetails.type !== 'complete') return;
    if (!hasMoreZeroTags) return;
    if (autoPagesRef.current >= AUTO_LOAD_MAX_PAGES) return;
    const last = accumulated[accumulated.length - 1];
    if (!last) return;
    autoPagesRef.current += 1;
    setCursor({ name: last.name, id: last.id });
  }, [autoLoadAll, isSearching, pageDetails.type, hasMoreZeroTags, accumulated]);

  return {
    availableTags,
    tagRows: accumulated,
    onSearch: setSearchQuery,
    hasMore: isSearching ? hasMoreVespaTags : hasMoreZeroTags,
    loadMore,
  };
};
