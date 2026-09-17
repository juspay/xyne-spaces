import { NavigationType } from 'react-router-dom';

/** React Router's key for the entry a page was loaded on (deep link, refresh, new tab). */
const INITIAL_LOCATION_KEY = 'default';

/**
 * Where an arrival came from, for `*_VIEWED` / `*_OPENED` events.
 *
 * The navigating surface sets `state.trackSource` on `navigate()` / `<Link>`
 * (useWorkspaceNavigate forwards NavigateOptions untouched). Three rules keep
 * the attribution honest:
 *   - POP means back/forward. React Router replays the ORIGINAL state on history
 *     navigation, so without this check a back button would re-report whichever
 *     surface the user first arrived from and inflate it.
 *   - POP is also what `useNavigationType()` reports for the very first render
 *     after a page load, which is not history at all. That entry carries the
 *     router's `default` key, so pass `location.key` to tell the two apart;
 *     the first-load case falls through to the state / `direct` rules.
 *   - No state at all means a deep link or an unattributed caller, not an error.
 *
 * `fallback` is for surfaces that carry attribution in the URL instead of
 * navigation state (`?src=` on links a plain `<a>` or `window.open` produced).
 */
export function readTrackSource(
  locationState: unknown,
  navigationType: NavigationType,
  locationKey?: string,
  fallback?: string | null,
): string {
  const isFirstLoad = locationKey === undefined ? false : locationKey === INITIAL_LOCATION_KEY;
  if (navigationType === NavigationType.Pop && !isFirstLoad) return 'history_pop';
  const navState = locationState as { trackSource?: unknown } | null | undefined;
  if (typeof navState?.trackSource === 'string') return navState.trackSource;
  return fallback || 'direct';
}

/** Coarse text-length dimension. Never send the text itself. */
export function lengthBucket(length: number): '0-50' | '51-200' | '201-1000' | '1000+' {
  if (length <= 50) return '0-50';
  if (length <= 200) return '51-200';
  if (length <= 1000) return '201-1000';
  return '1000+';
}
