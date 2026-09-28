import type { Location } from 'react-router-dom';
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

/** Same URL and history state, ignoring the per-navigation `key`. */
export const isSameLocation = (a: Location, b: Location): boolean =>
  a.pathname === b.pathname &&
  a.search === b.search &&
  a.hash === b.hash &&
  Object.is(a.state ?? null, b.state ?? null);

/** Identity, or two plain objects whose own values are identical. */
export const shallowEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(key =>
      Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
};
