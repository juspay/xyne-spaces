import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Default debounce delay for search query (ms) */
const SEARCH_DEBOUNCE_MS = 150;

/** Position of a match within the source items */
export interface TextSearchMatch {
  /** Index of the item containing the match */
  itemIndex: number;
  /** Character start position within the item's text */
  start: number;
  /** Character end position within the item's text */
  end: number;
}

export interface UseTextSearchOptions<T> {
  /** Items to search through */
  items: readonly T[];
  /** Function to extract searchable text from an item */
  getText: (item: T) => string;
  /** Whether search is case-sensitive (default: false) */
  caseSensitive?: boolean;
  /** Debounce delay in ms (default: 150) */
  debounceMs?: number;
}

export interface UseTextSearchReturn {
  /** Whether the search UI is open */
  isOpen: boolean;
  /** Current search query */
  query: string;
  /** All matches found */
  matches: TextSearchMatch[];
  /** Index of the currently focused match */
  currentIndex: number;
  /** Total number of matches */
  matchCount: number;
  /** Ref map for match elements (for scroll-to-match) */
  matchRefs: React.MutableRefObject<Map<number, HTMLElement>>;
  /** Open the search UI */
  open: () => void;
  /** Close the search UI and reset state */
  close: () => void;
  /** Update the search query */
  setQuery: (query: string) => void;
  /** Navigate to the next match */
  goToNext: () => void;
  /** Navigate to the previous match */
  goToPrevious: () => void;
  /** Handle keyboard events (Enter/Shift+Enter/Escape) */
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Generic hook for searching and navigating through text matches.
 * Works with any list of items that have extractable text content.
 *
 * @example
 * ```tsx
 * const search = useTextSearch({
 *   items: transcripts,
 *   getText: (entry) => entry.text,
 * });
 * ```
 */
export function useTextSearch<T>({
  items,
  getText,
  caseSensitive = false,
  debounceMs = SEARCH_DEBOUNCE_MS,
}: UseTextSearchOptions<T>): UseTextSearchReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const matchRefs = useRef<Map<number, HTMLElement>>(new Map());

  // Store getText in ref to avoid useMemo recalculation when caller passes inline function
  const getTextRef = useRef(getText);
  getTextRef.current = getText;

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  // Find all matches when debounced query or items change
  const matches = useMemo(() => {
    const trimmedQuery = debouncedQuery.trim();
    if (!trimmedQuery) return [];

    const results: TextSearchMatch[] = [];
    const normalizedQuery = caseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();

    items.forEach((item, itemIndex) => {
      const text = getTextRef.current(item);
      const normalizedText = caseSensitive ? text : text.toLowerCase();
      let searchStart = 0;

      while (searchStart < normalizedText.length) {
        const matchIndex = normalizedText.indexOf(normalizedQuery, searchStart);
        if (matchIndex === -1) break;

        results.push({
          itemIndex,
          start: matchIndex,
          end: matchIndex + trimmedQuery.length,
        });
        // Advance by query length to avoid overlapping matches
        searchStart = matchIndex + normalizedQuery.length;
      }
    });

    return results;
  }, [items, debouncedQuery, caseSensitive]);

  // Reset/clamp current index when matches change
  useEffect(() => {
    setCurrentIndex(prev => {
      if (matches.length === 0) return 0;
      // Clamp to valid range if matches decreased
      return Math.min(prev, matches.length - 1);
    });
  }, [matches.length]);

  // Scroll to current match when it changes
  useEffect(() => {
    if (matches.length === 0) return;

    const matchElement = matchRefs.current.get(currentIndex);
    if (matchElement) {
      matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentIndex, matches.length]);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setDebouncedQuery('');
    setCurrentIndex(0);
    matchRefs.current.clear();
  }, []);

  const goToNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex(prev => (prev + 1) % matches.length);
  }, [matches.length]);

  const goToPrevious = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex(prev => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }

      const goBackward = e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey);
      const goForward = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey);

      if (goBackward || goForward) {
        e.preventDefault();
        if (goBackward) {
          goToPrevious();
        } else {
          goToNext();
        }
      }
    },
    [close, goToNext, goToPrevious],
  );

  return {
    isOpen,
    query,
    matches,
    currentIndex,
    matchCount: matches.length,
    matchRefs,
    open,
    close,
    setQuery,
    goToNext,
    goToPrevious,
    handleKeyDown,
  };
}
