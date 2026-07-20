import { useEffect, useMemo, useRef } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useFileSearchContext } from './FileSearchContext';
import { ACTIVE_MATCH_ATTR } from './htmlHighlight';
import { getVisibleRect } from './scrollUtils';
import { findMatchesInLines, groupMatchesByRow } from './searchEngine';
import { MIN_QUERY_LENGTH, type HighlightRange, type SearchMatch } from './types';

interface LineSearchResult {
  /** Ranges keyed by line index, so a virtual row resolves its marks in O(1). */
  matchesByRow: Map<number, HighlightRange[]>;
  /** The match the user is currently on — drives scrolling. */
  activeMatch: SearchMatch | null;
  isSearchActive: boolean;
}

const EMPTY_MATCHES = new Map<number, HighlightRange[]>();

/**
 * Runs the find bar's query against a viewer's in-memory lines and reports the
 * count back to the find bar.
 *
 * `lines` must be plain text. CodeViewer keeps a plain-text shadow of its
 * highlight.js HTML for exactly this reason: offsets returned here are
 * plain-text offsets.
 */
export const useLineSearch = (lines: string[], enabled = true): LineSearchResult => {
  const search = useFileSearchContext();
  const registerTarget = search?.registerTarget;
  const reportTotal = search?.reportTotal;

  useEffect(() => {
    if (!enabled || !registerTarget) return;
    return registerTarget();
  }, [enabled, registerTarget]);

  const query = search?.query ?? '';
  const options = search?.options;
  const activeIndex = search?.activeIndex ?? 0;

  const isSearchActive = Boolean(enabled && search && query.length >= MIN_QUERY_LENGTH && options);

  const matches = useMemo<SearchMatch[]>(() => {
    if (!isSearchActive || !options) return [];
    return findMatchesInLines(lines, query, options);
  }, [isSearchActive, lines, query, options]);

  useEffect(() => {
    if (!reportTotal) return;
    // Report 0 while inactive so a cleared query resets the counter.
    reportTotal(isSearchActive ? matches.length : 0);
  }, [matches, isSearchActive, reportTotal]);

  // Clear the count when this viewer unmounts (e.g. carousel navigation),
  // otherwise a stale total lingers in the find bar.
  useEffect(() => {
    if (!enabled || !reportTotal) return;
    return (): void => reportTotal(0);
  }, [enabled, reportTotal]);

  const matchesByRow = useMemo(
    () => (matches.length ? groupMatchesByRow(matches, activeIndex) : EMPTY_MATCHES),
    [matches, activeIndex],
  );

  return {
    matchesByRow,
    activeMatch: matches[activeIndex] ?? null,
    isSearchActive,
  };
};

/**
 * Scrolls the active match into view.
 *
 * Reveals the MATCH, never its row. A single line can wrap far taller than the
 * viewport (a 114k-character paragraph wraps to ~17,000px), and centring such a
 * row scrolls thousands of pixels into the middle of it while the match itself
 * sits in view. The active <mark> is the match, so it is measured directly.
 */
export const useMatchScroll = (
  activeMatch: SearchMatch | null,
  virtualizer: Virtualizer<HTMLDivElement, Element> | null,
  isVirtualized: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
): void => {
  const row = activeMatch?.row ?? null;
  // Two matches on one line share a row, so keying the effect on `row` alone
  // would skip the scroll when stepping between them.
  const start = activeMatch?.start ?? null;
  const frameRef = useRef<number[]>([]);

  useEffect(() => {
    if (row === null) return undefined;

    const cancelPending = (): void => {
      frameRef.current.forEach(id => cancelAnimationFrame(id));
      frameRef.current = [];
    };
    cancelPending();

    /** Centres the match in the visible band, adjusting only our own scroller. */
    const tryReveal = (): boolean => {
      const container = containerRef.current;
      if (!container) return false;
      const mark = container.querySelector<HTMLElement>(`[${ACTIVE_MATCH_ATTR}="true"]`);
      if (!mark) return false;

      const markRect = mark.getBoundingClientRect();
      // Deliberately the visible band, not `container.getBoundingClientRect()`:
      // an ancestor may clip part of the scroller away, and a match hidden in
      // that strip must still count as off-screen.
      const view = getVisibleRect(container);
      const viewHeight = view.bottom - view.top;
      if (viewHeight <= 0) return false;

      // Leave an already-visible match alone: re-centring on every step makes
      // the view lurch for no reason.
      if (markRect.top >= view.top && markRect.bottom <= view.bottom) return true;

      // scrollTop math rather than scrollIntoView: the latter also scrolls every
      // scrollable ancestor, which would drag the modal shell around.
      const delta = markRect.top - view.top - (viewHeight - markRect.height) / 2;
      // Instant, never smooth: a ~400ms animation means a held Enter reads
      // mid-flight positions, so the view falls behind and can jump backwards.
      container.scrollTop += delta;
      return true;
    };

    // Already mounted (visible, or just outside in the overscan) — no need to
    // involve the virtualizer at all.
    if (tryReveal()) return cancelPending;

    if (isVirtualized && virtualizer) {
      // The row is outside the rendered window. scrollToIndex gets it mounted;
      // with dynamically measured rows the first landing is only approximate,
      // so re-assert, then centre on the match once it exists.
      virtualizer.scrollToIndex(row, { align: 'center' });
      const first = requestAnimationFrame(() => {
        virtualizer.scrollToIndex(row, { align: 'center' });
        const second = requestAnimationFrame(() => {
          tryReveal();
        });
        frameRef.current.push(second);
      });
      frameRef.current.push(first);
      return cancelPending;
    }

    const pending = requestAnimationFrame(() => {
      tryReveal();
    });
    frameRef.current.push(pending);

    return cancelPending;
  }, [row, start, isVirtualized, virtualizer, containerRef]);
};
