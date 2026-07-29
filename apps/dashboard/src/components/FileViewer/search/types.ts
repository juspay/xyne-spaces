export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
};

/**
 * A single match addressed in the viewer's own data-model coordinates, not in
 * DOM coordinates. Viewers virtualize (only ~30 of N rows are ever mounted), so
 * matches are found by scanning the data the viewer holds in state and are
 * addressed by row/column index. `start`/`end` are character offsets into that
 * cell's plain text.
 */
export interface SearchMatch {
  row: number;
  start: number;
  end: number;
  /** Column index for grid viewers (CSV/Excel). Absent for line-based viewers. */
  col?: number;
  /** Sheet index for multi-sheet viewers (Excel). Absent elsewhere. */
  sheet?: number;
}

/** Highlight ranges within a single line, in that line's plain-text offsets. */
export interface HighlightRange {
  start: number;
  end: number;
  isActive: boolean;
}

/**
 * Scanning stops here so a pathological query (e.g. a single space against a
 * 100MB log) can't exhaust memory or lock the main thread.
 */
export const MAX_MATCHES = 5000;

/** Queries shorter than this are ignored — one character matches near-everything. */
export const MIN_QUERY_LENGTH = 1;
