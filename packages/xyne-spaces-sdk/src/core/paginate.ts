/**
 * Client-side pagination for catalog operations with no server-side cursor.
 *
 * Some Zero queries — `conversationMessagesV2`, `channelParticipants`,
 * `ticketActivities`, `getUsersV2`, and others — return every matching row in
 * one response; their schema takes no `limit`/`start` at all, so there is
 * nothing to ask the server for "the next page" with. That is fine for Zero's
 * own incremental sync, where a browser holds the live set and a component
 * renders a window of it, and wrong for a one-shot HTTP fetch: a caller that
 * wants the last 20 messages of a long-running thread would otherwise pay
 * for, and receive, all of them.
 *
 * `paginate` does the one thing available without a backend change: it takes
 * the full result the operation already returned and windows it before
 * handing it back. The network cost of the full fetch is real and is not
 * solved here — that needs a paginated variant of the underlying Zero query,
 * which is a backend change. What this removes is a caller having to hold and
 * iterate an unbounded array just to render one page of it.
 */

const DEFAULT_LIMIT = 50;

export interface PageOptions {
  /** Rows to return. Defaults to 50. */
  limit?: number;
  /** Rows to skip before the returned page. Defaults to 0. */
  offset?: number;
}

export interface Page<T> {
  /** Rows in this page. */
  items: T[];
  /** True when the fetched result held rows beyond this page. */
  hasMore: boolean;
  /** Total rows in the underlying, already-fetched result. */
  total: number;
  /** Pass as `offset` to fetch the next page with the same call. */
  nextOffset: number;
}

/** Window an already-fetched array into one page. */
export function paginate<T>(all: readonly T[], options?: PageOptions): Page<T> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const offset = Math.max(options?.offset ?? 0, 0);
  const items = all.slice(offset, offset + limit);
  return {
    items,
    hasMore: offset + items.length < all.length,
    total: all.length,
    nextOffset: offset + items.length,
  };
}
