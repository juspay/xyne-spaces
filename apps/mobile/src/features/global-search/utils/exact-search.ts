/**
 * Exact ("phrase") search helpers — port of dashboard `exactSearch.ts`.
 *
 * A query wrapped in double quotes is matched as a strict adjacent-term phrase.
 * The backend detects the quotes itself; exactness is a boolean in UI state and
 * only becomes quotes on the way out via `toSearchQuery`.
 */

export const hasExactSearchQuotes = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
};

/** Mirrors backend `isExactMatch` in vespa searchService. */
export const isExactSearchQuery = (value: string): boolean =>
  hasExactSearchQuotes(value) && value.trim().slice(1, -1).trim().length > 0;

export const unwrapExactSearchQuery = (value: string): string => {
  const trimmed = value.trim();
  return hasExactSearchQuotes(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
};

export const wrapExactSearchQuery = (value: string): string => {
  const inner = unwrapExactSearchQuery(value);
  return inner ? `"${inner}"` : '';
};

/**
 * The query string a search request actually carries. Exactness lives as a
 * boolean in app state and only becomes quotes here. Loose mode passes text
 * through untouched so user-typed quotes still reach the backend.
 */
export const toSearchQuery = (value: string, exact: boolean): string => {
  const trimmed = value.trim();
  return exact ? wrapExactSearchQuery(trimmed) : trimmed;
};
