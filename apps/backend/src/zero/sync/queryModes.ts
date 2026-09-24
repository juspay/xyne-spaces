/**
 * Per-query serve mode for the sync engine — a SERVER-SIDE, in-code map.
 *
 * The COMPILED registries remain the security boundary: a query name never in the
 * CI-audited allowlists is refused regardless of what this map says (the map can only
 * SUBTRACT from the audited set, never add). Within that set, each query is either:
 *   - 'serve'  — engine serves it; the client displays the sync result.
 *   - 'shadow' — engine serves it; the client subscribes BOTH and displays native Zero
 *                (observation state — run both, promote to 'serve' after the soak).
 * A query NOT listed here is 'off': the gateway refuses the subscribe and the client
 * stays fully native. Promotion (shadow → serve) or onboarding (add an entry) is a code
 * change + deploy — no env, no remote config.
 *
 * The active map rides the `sync:ready` payload (as `{ default: 'off', queries }`, so the
 * client's existing `queries[q] ?? default` resolves an unlisted query to 'off'), so
 * clients learn modes on every (re)connect with no extra round-trips; a deploy that
 * changes the map applies to NEW subscribes (drain semantics — no revoke stampedes).
 */

export type QueryMode = 'serve' | 'shadow' | 'off';

export interface QueryModesConfig {
  default: QueryMode;
  queries: Record<string, QueryMode>;
}

/**
 * The onboarded queries and their mode. Absent ⇒ 'off'. Keep in sync with the compiled
 * registries (SHARED_BASE_QUERIES + the row-level specs) — an onboarded query left out
 * here is served by nothing; a name here that isn't in a registry is refused anyway.
 */
const QUERY_MODES: Record<string, Exclude<QueryMode, 'off'>> = {
  // Gate plane
  channelLatestMultipleConversationsV4: 'serve',
  getUsersV2: 'serve',
  getAllUserGroups: 'serve',
  // Row-level plane
  userDrafts: 'serve',
  userBookmarks: 'serve',
  getCurrentUserPreference: 'serve',
};

let active: QueryModesConfig = { default: 'off', queries: { ...QUERY_MODES } };

/** Test seam: pin a config (null = reset to the in-code map). */
export function setQueryModesForTests(cfg: QueryModesConfig | null): void {
  active = cfg ?? { default: 'off', queries: { ...QUERY_MODES } };
}

/** The mode for an (already registry-audited) query. Synchronous — sits on the subscribe path. */
export function modeFor(queryName: string): QueryMode {
  return active.queries[queryName] ?? active.default;
}

/** The active config, for the `sync:ready` payload. */
export function modesSnapshot(): QueryModesConfig {
  return { default: active.default, queries: { ...active.queries } };
}
