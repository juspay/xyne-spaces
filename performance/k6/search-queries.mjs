// Read-only load for GET /api/vespaSearch/ — Wave 2's top item in
// docs/performance-testing-priority-decision.md: the second-slowest endpoint group
// (p95 ~2.0s) and the one whose cost is ACL-filtered retrieval rather than raw IO.
//
// Pure data and functions only — no k6 globals — so the k6 scenario and the Node test
// suite can both import it.
//
// Contract verified against apps/backend/src/validators/vespaSearchValidator.ts:
//   q       required, 0-500 chars
//   apps    comma-separated from chat|ticket|user|file|collection|mail|xyneapp|call
//   limit   integer 1-400  (default 20)
//   offset  integer 0-1000 (default 0)

export const MAX_TERM_LENGTH = 500;
export const MAX_LIMIT = 400;
export const MAX_OFFSET = 1000;

/**
 * Generic terms, used when an identity supplies none.
 *
 * Deliberately ordinary words rather than anything resembling customer content, so a
 * run carries no real data and its queries are reproducible across environments.
 */
export const DEFAULT_SEARCH_TERMS = Object.freeze([
  'release',
  'meeting notes',
  'deployment',
  'status update',
  'review',
]);

/**
 * App filters to rotate through. Retrieval cost is not uniform across the corpus, so a
 * single filter would report one shape of query as if it were the whole search path.
 */
export const SEARCH_APP_SETS = Object.freeze([
  'chat',
  'ticket',
  'chat,ticket,user,file,mail',
]);

export function selectSearchTerms(user) {
  const terms = user?.searchTerms;
  return Array.isArray(terms) && terms.length > 0 ? terms : DEFAULT_SEARCH_TERMS;
}

export function buildSearchPath({ term, apps, limit, offset }) {
  if (typeof term !== 'string' || term.length > MAX_TERM_LENGTH) {
    throw new Error(`Search term must be a string of at most ${MAX_TERM_LENGTH} characters`);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`Search limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new Error(`Search offset must be an integer between 0 and ${MAX_OFFSET}`);
  }

  const query = [
    `q=${encodeURIComponent(term)}`,
    `apps=${encodeURIComponent(apps)}`,
    `limit=${limit}`,
    `offset=${offset}`,
  ].join('&');

  return `/api/vespaSearch/?${query}`;
}

/**
 * The result rows of a search response.
 *
 * The default path answers `{success, data:{results, totalCount, ...}}`; a grouped
 * response answers `{success, results, total}`. Accept either.
 */
export function searchResults(body) {
  if (Array.isArray(body?.data?.results)) return body.data.results;
  if (Array.isArray(body?.results)) return body.results;
  return undefined;
}
