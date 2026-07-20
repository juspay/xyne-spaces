import { MAX_MATCHES, type HighlightRange, type SearchMatch, type SearchOptions } from './types';

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

const escapeRegExp = (value: string): string => value.replace(REGEXP_SPECIALS, '\\$&');

/**
 * Builds the matcher for a literal (non-regex) query. Returns null for an empty
 * query so callers can treat "no matcher" as "no search in progress".
 */
export const buildMatcher = (query: string, options: SearchOptions): RegExp | null => {
  if (!query) return null;

  let pattern = escapeRegExp(query);
  if (options.wholeWord) {
    // \b is only meaningful next to a word character; anchoring a query that
    // starts/ends with punctuation would make it unmatchable rather than
    // "whole word", so only anchor the ends that can actually carry a boundary.
    const leading = /^\w/.test(query) ? '\\b' : '';
    const trailing = /\w$/.test(query) ? '\\b' : '';
    pattern = `${leading}${pattern}${trailing}`;
  }

  try {
    return new RegExp(pattern, options.caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
};

/** Collects matches within one string. Exported for grid viewers that scan cells. */
export const findMatchesInText = (
  text: string,
  matcher: RegExp,
  onMatch: (start: number, end: number) => boolean,
): void => {
  matcher.lastIndex = 0;
  let result: RegExpExecArray | null;

  while ((result = matcher.exec(text)) !== null) {
    if (result[0].length === 0) {
      // A zero-length match never advances lastIndex — step over it manually or
      // exec() spins forever.
      matcher.lastIndex += 1;
      continue;
    }
    const shouldContinue = onMatch(result.index, result.index + result[0].length);
    if (!shouldContinue) return;
  }
};

/**
 * Scans every line, including the ones the virtualizer hasn't mounted. This is
 * the whole point of searching the data model rather than the rendered DOM.
 */
export const findMatchesInLines = (
  lines: string[],
  query: string,
  options: SearchOptions,
): SearchMatch[] => {
  const matcher = buildMatcher(query, options);
  if (!matcher) return [];

  const matches: SearchMatch[] = [];

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row];
    if (!line) continue;

    findMatchesInText(line, matcher, (start, end) => {
      matches.push({ row, start, end });
      return matches.length < MAX_MATCHES;
    });

    if (matches.length >= MAX_MATCHES) break;
  }

  return matches;
};

/** Groups matches by row so a virtual row can look up its ranges in O(1). */
export const groupMatchesByRow = (
  matches: SearchMatch[],
  activeIndex: number,
): Map<number, HighlightRange[]> => {
  const byRow = new Map<number, HighlightRange[]>();

  matches.forEach((match, index) => {
    const ranges = byRow.get(match.row);
    const range: HighlightRange = {
      start: match.start,
      end: match.end,
      isActive: index === activeIndex,
    };
    if (ranges) {
      ranges.push(range);
    } else {
      byRow.set(match.row, [range]);
    }
  });

  return byRow;
};

/**
 * Scans every cell of a grid, including rows/columns the virtualizers haven't
 * mounted — the grid analogue of findMatchesInLines. Cells must already be
 * plain strings (callers memo-coerce non-string cells, e.g. Excel's dates).
 * `sheet`, when provided, is stamped onto every match so multi-sheet viewers
 * can tell which sheet a match belongs to.
 */
export const findMatchesInGrid = (
  grid: string[][],
  query: string,
  options: SearchOptions,
  sheet?: number,
): SearchMatch[] => {
  const matcher = buildMatcher(query, options);
  if (!matcher) return [];

  const matches: SearchMatch[] = [];

  for (let row = 0; row < grid.length; row++) {
    const cells = grid[row];
    if (!cells) continue;

    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col];
      if (!cell) continue;

      findMatchesInText(cell, matcher, (start, end) => {
        matches.push(
          sheet === undefined ? { row, col, start, end } : { sheet, row, col, start, end },
        );
        return matches.length < MAX_MATCHES;
      });

      if (matches.length >= MAX_MATCHES) return matches;
    }
  }

  return matches;
};

/** Groups matches by `"row:col"` so a cell can look up its ranges in O(1). */
export const groupMatchesByCell = (
  matches: SearchMatch[],
  activeIndex: number,
): Map<string, HighlightRange[]> => {
  const byCell = new Map<string, HighlightRange[]>();

  matches.forEach((match, index) => {
    const key = `${match.row}:${match.col ?? 0}`;
    const ranges = byCell.get(key);
    const range: HighlightRange = {
      start: match.start,
      end: match.end,
      isActive: index === activeIndex,
    };
    if (ranges) {
      ranges.push(range);
    } else {
      byCell.set(key, [range]);
    }
  });

  return byCell;
};
