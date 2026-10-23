// Read-only load for GET /api/vespaSearch/. The second-slowest endpoint group in
// production (p95 ~2.0s across 555K requests over fourteen days), and the one whose cost
// is ACL-filtered retrieval rather than raw IO.
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
 * Whether a search response is grouped by docType.
 *
 * The backend groups whenever more than one app is requested
 * (apps/backend/src/vespa/src/utils/YqlBuilder.ts `shouldGroup`), and answers
 * `{success, data:{grouped: true, groups:[{groupBy, groupValue, count, results}], ...}}`
 * (apps/backend/src/services/vespaSearch/index.ts, grouped branch of searchHandler).
 */
export function isGroupedSearch(body) {
  return body?.data?.grouped === true;
}

/**
 * The result rows of a search response.
 *
 * A single-app search answers `{success, data:{results, totalCount, ...}}`; a multi-app
 * search answers groups, whose rows are flattened here; the `appsView` path answers
 * `{success, results, total}`. Anything else is `undefined`.
 */
export function searchResults(body) {
  if (isGroupedSearch(body)) {
    return Array.isArray(body.data.groups)
      ? body.data.groups.flatMap((group) => (Array.isArray(group?.results) ? group.results : []))
      : undefined;
  }
  if (Array.isArray(body?.data?.results)) return body.data.results;
  if (Array.isArray(body?.results)) return body.results;
  return undefined;
}
