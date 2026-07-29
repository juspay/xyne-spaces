import { useEffect, useMemo, useRef } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { useFileSearchContext } from './FileSearchContext';
import { ACTIVE_CELL_ATTR } from './htmlHighlight';
import { getVisibleRect } from './scrollUtils';
import { findMatchesInGrid, groupMatchesByCell } from './searchEngine';
import { MAX_MATCHES, MIN_QUERY_LENGTH, type HighlightRange, type SearchMatch } from './types';

const EMPTY_CELLS = new Map<string, HighlightRange[]>();

/** Look up a cell's highlight ranges by `"row:col"`. */
export const cellKey = (row: number, col: number): string => `${row}:${col}`;

interface GridSearchResult {
  matchesByCell: Map<string, HighlightRange[]>;
  activeMatch: SearchMatch | null;
  isSearchActive: boolean;
}

/**
 * Runs the find bar's query against a single grid's in-memory cells (CSV). The
 * grid analogue of useLineSearch: matches come from the data model, so a cell
 * the row/column virtualizers never mounted is still found.
 */
export const useGridSearch = (grid: string[][], enabled = true): GridSearchResult => {
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
    return findMatchesInGrid(grid, query, options);
  }, [isSearchActive, grid, query, options]);

  useEffect(() => {
    if (!reportTotal) return;
    reportTotal(isSearchActive ? matches.length : 0);
  }, [matches, isSearchActive, reportTotal]);

  useEffect(() => {
    if (!enabled || !reportTotal) return;
    return (): void => reportTotal(0);
  }, [enabled, reportTotal]);

  const matchesByCell = useMemo(
    () => (matches.length ? groupMatchesByCell(matches, activeIndex) : EMPTY_CELLS),
    [matches, activeIndex],
  );

  return {
    matchesByCell,
    activeMatch: matches[activeIndex] ?? null,
    isSearchActive,
  };
};

interface SheetsSearchResult {
  /** Ranges for the ACTIVE sheet's cells only. */
  matchesByCell: Map<string, HighlightRange[]>;
  /** The active match, but only when it lies on the currently shown sheet. */
  activeCellMatch: SearchMatch | null;
  isSearchActive: boolean;
}

interface SheetLike {
  data: unknown[][];
}

const EMPTY_GRIDS: string[][][] = [];

/**
 * Matches ExcelViewer's own `cell?.toString() ?? ''` rendering so search text
 * is exactly what's shown (numbers, booleans, and `cellDates` Date objects
 * included). Worker cells are always string/number/boolean/Date, never plain
 * objects, so `String` yields a meaningful value.
 */
const coerceCell = (cell: unknown): string => {
  if (cell === null || cell === undefined) return '';
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- cells are primitives/Date
  return String(cell);
};

/**
 * Runs the query across EVERY sheet of a workbook (Excel). Matches carry a
 * sheet index; when the active match is on another sheet this switches to it,
 * and only exposes the match for scrolling once that sheet is actually shown.
 *
 * Cells are coerced to strings lazily — only once a search is active — so a
 * workbook that is opened but never searched pays nothing, and the coercion is
 * keyed on the sheets, not the query, so it doesn't rerun on every keystroke.
 */
export const useSheetsSearch = (
  sheets: SheetLike[],
  activeSheet: number,
  setActiveSheet: (index: number) => void,
  enabled = true,
): SheetsSearchResult => {
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

  const stringGrids = useMemo<string[][][]>(() => {
    if (!isSearchActive) return EMPTY_GRIDS;
    return sheets.map(sheet => sheet.data.map(row => row.map(coerceCell)));
  }, [isSearchActive, sheets]);

  const matches = useMemo<SearchMatch[]>(() => {
    if (!isSearchActive || !options) return [];
    const all: SearchMatch[] = [];
    for (let sheet = 0; sheet < stringGrids.length; sheet++) {
      const grid = stringGrids[sheet];
      if (!grid) continue;
      const remaining = MAX_MATCHES - all.length;
      if (remaining <= 0) break;
      // findMatchesInGrid caps at MAX_MATCHES internally; slicing keeps the
      // cross-sheet total bounded without a second full scan.
      const found = findMatchesInGrid(grid, query, options, sheet);
      all.push(...(found.length > remaining ? found.slice(0, remaining) : found));
    }
    return all;
  }, [isSearchActive, stringGrids, query, options]);

  useEffect(() => {
    if (!reportTotal) return;
    reportTotal(isSearchActive ? matches.length : 0);
  }, [matches, isSearchActive, reportTotal]);

  useEffect(() => {
    if (!enabled || !reportTotal) return;
    return (): void => reportTotal(0);
  }, [enabled, reportTotal]);

  const activeMatch = matches[activeIndex] ?? null;
  const targetSheet = activeMatch?.sheet;
  const matchKey =
    activeMatch === null
      ? null
      : `${activeMatch.sheet}:${activeMatch.row}:${activeMatch.col ?? 0}:${activeMatch.start}`;
  const lastNavRef = useRef<string | null>(null);

  // Bring the active match's sheet into view — but only when the user actually
  // navigated to a new match, keyed on the match's identity. Otherwise a manual
  // sheet switch (clicking another tab while search is open) would be yanked
  // straight back to the active match's sheet.
  useEffect(() => {
    if (matchKey === null || targetSheet === undefined) return;
    if (lastNavRef.current === matchKey) return;
    lastNavRef.current = matchKey;
    if (targetSheet !== activeSheet) setActiveSheet(targetSheet);
  }, [matchKey, targetSheet, activeSheet, setActiveSheet]);

  // Ranges for the shown sheet only, but isActive is keyed off the GLOBAL match
  // index so the one active highlight is correct across sheets.
  const matchesByCell = useMemo(() => {
    if (!matches.length) return EMPTY_CELLS;
    const byCell = new Map<string, HighlightRange[]>();
    matches.forEach((match, index) => {
      if (match.sheet !== activeSheet) return;
      const key = cellKey(match.row, match.col ?? 0);
      const range: HighlightRange = {
        start: match.start,
        end: match.end,
        isActive: index === activeIndex,
      };
      const ranges = byCell.get(key);
      if (ranges) ranges.push(range);
      else byCell.set(key, [range]);
    });
    return byCell.size ? byCell : EMPTY_CELLS;
  }, [matches, activeIndex, activeSheet]);

  return {
    matchesByCell,
    activeCellMatch: activeMatch && activeMatch.sheet === activeSheet ? activeMatch : null,
    isSearchActive,
  };
};

/**
 * Scrolls the active grid match into view, in both axes.
 *
 * Like useMatchScroll but for a single scroller driven by two virtualizers.
 * The match is revealed by measuring the active <mark> directly, so a cell that
 * wraps or a value inside a tall row still centres correctly. When the target
 * cell is outside the rendered window, the relevant virtualizer(s) mount it
 * first, then the mark is centred once it exists.
 */
export const useGridMatchScroll = (
  activeMatch: SearchMatch | null,
  rowVirtualizer: Virtualizer<HTMLDivElement, Element> | null,
  colVirtualizer: Virtualizer<HTMLDivElement, Element> | null,
  rowsVirtualized: boolean,
  colsVirtualized: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
): void => {
  const row = activeMatch?.row ?? null;
  const col = activeMatch?.col ?? null;
  const start = activeMatch?.start ?? null;
  const sheet = activeMatch?.sheet ?? null;
  const frameRef = useRef<number[]>([]);

  useEffect(() => {
    if (row === null || col === null) return undefined;

    const cancelPending = (): void => {
      frameRef.current.forEach(id => cancelAnimationFrame(id));
      frameRef.current = [];
    };
    cancelPending();

    /** Centres the active CELL in the visible rect, adjusting only our scroller. */
    const tryReveal = (): boolean => {
      const container = containerRef.current;
      if (!container) return false;
      // Reveal the cell, not the <mark>: a cell clips its content, so a match
      // past the ellipsis has a layout rect far outside the cell and centring
      // on it would scroll to empty space. The cell rect is one row × one
      // column, so centring it lands the match's cell squarely in view.
      const cell = container.querySelector<HTMLElement>(`[${ACTIVE_CELL_ATTR}="true"]`);
      if (!cell) return false;

      const cellRect = cell.getBoundingClientRect();
      const view = getVisibleRect(container);
      const viewHeight = view.bottom - view.top;
      const viewWidth = view.right - view.left;
      if (viewHeight <= 0 || viewWidth <= 0) return false;

      // Only nudge an axis on which the cell is actually off-screen, so an
      // already-visible cell doesn't lurch.
      if (cellRect.top < view.top || cellRect.bottom > view.bottom) {
        container.scrollTop += cellRect.top - view.top - (viewHeight - cellRect.height) / 2;
      }
      if (cellRect.left < view.left || cellRect.right > view.right) {
        container.scrollLeft += cellRect.left - view.left - (viewWidth - cellRect.width) / 2;
      }
      return true;
    };

    // Cell already mounted (visible or in overscan) — no virtualizer needed.
    if (tryReveal()) return cancelPending;

    // Mount the target cell. Each axis' virtualizer only moves that axis; the
    // non-virtualized axis is native scroll, handled by tryReveal via the mark.
    if (rowsVirtualized && rowVirtualizer) rowVirtualizer.scrollToIndex(row, { align: 'center' });
    if (colsVirtualized && colVirtualizer) colVirtualizer.scrollToIndex(col, { align: 'center' });

    const first = requestAnimationFrame(() => {
      // Re-assert: with estimated sizes the first landing is approximate.
      if (rowsVirtualized && rowVirtualizer) rowVirtualizer.scrollToIndex(row, { align: 'center' });
      if (colsVirtualized && colVirtualizer) colVirtualizer.scrollToIndex(col, { align: 'center' });
      const second = requestAnimationFrame(() => {
        tryReveal();
      });
      frameRef.current.push(second);
    });
    frameRef.current.push(first);

    return cancelPending;
  }, [
    row,
    col,
    start,
    sheet,
    rowsVirtualized,
    colsVirtualized,
    rowVirtualizer,
    colVirtualizer,
    containerRef,
  ]);
};
