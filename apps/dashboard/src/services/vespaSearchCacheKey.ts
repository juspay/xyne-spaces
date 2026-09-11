// Pure cache-key logic for the vespaSearch handoff cache (see searchService.ts). Kept in its
// own side-effect-free module so it can be unit-tested without importing the axios/logger/config
// chain that searchService pulls in. Runnable directly by `node --test`.

// Comma-joined params whose items form an order-insensitive set (OR filters). Sorting their
// items in the key means from=a,b and from=b,a hit the same entry without changing the request.
export const ORDER_INSENSITIVE_LIST_PARAMS = [
  'apps',
  'from',
  'fromEmail',
  'toEmail',
  'in',
  'mentions',
  'channelMentions',
  'assignee',
  'tags',
  'dynamicFieldValues',
];

/**
 * Build a stable cache key from a vespaSearch request's wire params.
 *
 * The key is order-independent — both the param keys and the items of set-like list params are
 * sorted — and it ignores `searchId` (changes per palette session). Absent `groupBy` is
 * normalized to the backend default `docType`, so the popup (which omits it) and the full-screen
 * page (which sends `docType`) collide; an explicit `groupBy: ''` (flat load-more) stays distinct.
 */
export function buildVespaSearchCacheKey(params: Record<string, string>): string {
  const keyParams: Record<string, string> = { ...params, groupBy: params['groupBy'] ?? 'docType' };
  delete keyParams['searchId'];
  // Highlight-only + derived from the mention ids already in the key; its array order differs
  // between the popup (click order) and the results screen (URL parse order), so keeping it
  // would break order-insensitivity and make mention searches always miss the handoff cache.
  delete keyParams['mentionHighlights'];
  for (const listParam of ORDER_INSENSITIVE_LIST_PARAMS) {
    const value = keyParams[listParam];
    if (value) {
      keyParams[listParam] = value.split(',').sort().join(',');
    }
  }
  return JSON.stringify(
    Object.keys(keyParams)
      .sort()
      .map(key => [key, keyParams[key]]),
  );
}
