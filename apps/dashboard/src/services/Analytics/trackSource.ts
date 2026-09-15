import { NavigationType } from 'react-router-dom';

/**
 * Where an arrival came from, for `*_VIEWED` / `*_OPENED` events.
 *
 * The navigating surface sets `state.trackSource` on `navigate()` / `<Link>`
 * (useWorkspaceNavigate forwards NavigateOptions untouched). Two rules keep the
 * attribution honest:
 *   - POP means back/forward. React Router replays the ORIGINAL state on history
 *     navigation, so without this check a back button would re-report whichever
 *     surface the user first arrived from and inflate it.
 *   - No state at all means a deep link or an unattributed caller, not an error.
 */
export function readTrackSource(locationState: unknown, navigationType: NavigationType): string {
  if (navigationType === NavigationType.Pop) return 'history_pop';
  const navState = locationState as { trackSource?: unknown } | null | undefined;
  return typeof navState?.trackSource === 'string' ? navState.trackSource : 'direct';
}

/** Coarse text-length dimension. Never send the text itself. */
export function lengthBucket(length: number): '0-50' | '51-200' | '201-1000' | '1000+' {
  if (length <= 50) return '0-50';
  if (length <= 200) return '51-200';
  if (length <= 1000) return '201-1000';
  return '1000+';
}
