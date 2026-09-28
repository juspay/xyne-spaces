import type { KeepAlivePane } from './KeepAliveOutlet.types';

/**
 * Moves `pane` to the most-recently-active end of `panes`, then trims the
 * least-recently-active entries down to `max`.
 *
 * Pure and idempotent: re-applying with a pane that is already newest returns an
 * equivalent list, so a StrictMode double-render cannot reorder or evict twice.
 */
export const upsertPane = (
  panes: readonly KeepAlivePane[],
  pane: KeepAlivePane,
  max: number,
): KeepAlivePane[] => {
  const next = panes.filter(existing => existing.key !== pane.key);
  next.push(pane);
  const limit = Math.max(1, max);
  return next.length > limit ? next.slice(next.length - limit) : next;
};
