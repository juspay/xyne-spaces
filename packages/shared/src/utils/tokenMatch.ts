// Cap query tokens so a pathological pasted query can't blow up the O(N·Q·L) token scan.
const MAX_QUERY_TOKENS = 8;

/**
 * True when every whitespace/comma-separated token in `query` appears as a substring of `text`,
 * in any order. Enables order-independent, partial-word name matching:
 *   'hars patil' → 'Harsharanga Ramappa Patil' ; 'prasad siva' → 'Bannala Siva Prasad'
 * Empty query → true (no constraint). Tokens beyond MAX_QUERY_TOKENS are ignored.
 *
 * Out-of-order comes from testing each token against the whole string independently; partial-word
 * comes from `includes` being a substring test. Complements Fuse (which needs a contiguous run).
 * Deliberately dependency-free so it stays cheap and unit-testable in isolation.
 */
export function matchesAllTokens(text: string, query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return true;
  const haystack = text.toLowerCase();
  return tokens.every(token => haystack.includes(token));
}
