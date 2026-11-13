/**
 * The one place a page size is decided. Every list the runtime exposes goes
 * through {@link resolvePage}, so there is no path to an unbounded read.
 *
 * In the runtime rather than the router because a host embedding the runtime
 * directly — a queue worker, a CLI, an agent tool — never passes through the
 * router, and a bound applied only at the HTTP edge is one they silently lack.
 */

import type { CursorPage } from '../persistence/types.js';

/** What a caller gets when it does not ask for a size. */
export const DEFAULT_PAGE = 25;

/**
 * The largest page anyone can have. Sized so one page of the heaviest list —
 * the approvals inbox, with its joins — stays a cheap query.
 */
export const MAX_PAGE = 100;

/**
 * Normalise whatever a caller asked for into a page the database can serve.
 * Nonsense limits become {@link DEFAULT_PAGE}; oversized ones clamp to
 * {@link MAX_PAGE} rather than erroring, since they are usually a stale client.
 *
 * An empty-string cursor (`?cursor=` with nothing after it) is dropped — taken
 * literally it would seek a row whose id is `''` and page forever.
 */
export function resolvePage(requested?: {
  limit?: number | undefined;
  cursor?: string | undefined;
}): CursorPage {
  const asked = requested?.limit;
  const limit =
    typeof asked === 'number' && Number.isFinite(asked) && asked >= 1
      ? Math.min(Math.floor(asked), MAX_PAGE)
      : DEFAULT_PAGE;

  const cursor = requested?.cursor;
  return cursor !== undefined && cursor !== ''
    ? { limit, cursor }
    : { limit };
}
