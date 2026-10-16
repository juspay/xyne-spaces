/**
 * Failures that can terminate an open. Neutral home — imported by both
 * `intent/` (parse) and `machine/` (timeouts, not-found, offline).
 *
 * `invalid-intent` keeps the raw params so the failure can be replayed
 * from the actual link (design §12.2).
 */
export type OpenFailure =
  | { reason: 'invalid-intent'; raw: Readonly<Record<string, unknown>> }
  | { reason: 'not-found' }
  | { reason: 'no-access' }
  | { reason: 'anchor-unreachable' }
  | { reason: 'timeout'; stage: 'resolving' | 'loading' }
  | { reason: 'live-error' }
  | { reason: 'offline-cold' };
