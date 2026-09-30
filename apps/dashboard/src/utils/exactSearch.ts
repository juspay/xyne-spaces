/**
 * Exact ("phrase") search.
 *
 * A query wrapped in double quotes — `"payment failed"` — is matched as a strict
 * adjacent-term phrase: every word must be present, in the same order, with nothing
 * between them. The backend detects the quotes itself (see the Vespa searchService:
 * grammar:"phrase" + rules.off), so the quotes are part of the query string and are
 * sent through untouched.
 */

/**
 * The query is *written* as an exact phrase. The search box never puts quotes there
 * itself — exact mode is its own toggle — but a user may still type them by hand,
 * and the backend honours those.
 */
export const hasExactSearchQuotes = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"');
};

/**
 * The text a query actually searches for: the phrase inside the quotes, or the query
 * unchanged when it isn't quoted. Empty for a bare `""`, which searches for nothing.
 */
export const unwrapExactSearchQuery = (value: string): string => {
  const trimmed = value.trim();
  return hasExactSearchQuotes(trimmed) ? trimmed.slice(1, -1).trim() : trimmed;
};

/**
 * Quote a query so it is searched as an exact phrase. This is applied on the way to the
 * search, not to what the box displays — the user never sees the quotes.
 */
export const wrapExactSearchQuery = (value: string): string => {
  const inner = unwrapExactSearchQuery(value);
  return inner ? `"${inner}"` : '';
};

/**
 * The query string a search request actually carries, given the box's text and the mode
 * flag beside it. This is the ONE place the mode is folded into the query — exactness
 * lives as a boolean in app state and only becomes quotes on the way out, so nothing
 * downstream has to ask a string which mode it is in.
 *
 * Loose mode passes the text through untouched, quotes and all: a user who typed their
 * own quotes meant them, and the backend reads those exactly as it reads ours.
 */
export const toSearchQuery = (value: string, exact: boolean): string => {
  const trimmed = value.trim();
  return exact ? wrapExactSearchQuery(trimmed) : trimmed;
};
