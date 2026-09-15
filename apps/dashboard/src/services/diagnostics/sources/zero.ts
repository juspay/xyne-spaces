import { subscribePendingMutations } from '@xyne/shared/hooks';
import { diagnosticsStore } from '../store';
import type { ZeroConnectionName } from '../types';

/**
 * The subset of the Zero client this module needs. Typing it structurally keeps
 * diagnostics from depending on the concrete `Zero<Schema>` generic, which the
 * provider parameterises differently.
 */
interface ZeroConnectionSource {
  connection?: {
    state: {
      current: { name: string; reason?: unknown };
      subscribe: (listener: (state: { name: string; reason?: unknown }) => void) => () => void;
    };
  };
}

/**
 * A connection that stays down emits no further transitions, so the offline
 * share and churn rate have to be re-derived on a timer as well.
 */
const REFRESH_MS = 5000;

let detachCurrent: (() => void) | null = null;

const CONNECTION_NAMES = new Set<ZeroConnectionName>([
  'connected',
  'connecting',
  'disconnected',
  'needs-auth',
  'error',
  'closed',
]);

function toConnectionName(name: string): ZeroConnectionName {
  return CONNECTION_NAMES.has(name as ZeroConnectionName)
    ? (name as ZeroConnectionName)
    : 'unknown';
}

/**
 * Zero's `reason` is a plain string for most states but a structured object for
 * `needs-auth` (which carries the failing surface and HTTP status). Flatten it
 * to something a person can read in the panel without losing the detail.
 */
function describeReason(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason && typeof reason === 'object') {
    const r = reason as Record<string, unknown>;
    if (typeof r['reason'] === 'string') return r['reason'];
    const type = typeof r['type'] === 'string' ? r['type'] : 'auth';
    const status = typeof r['status'] === 'number' ? ` ${r['status']}` : '';
    return `${type}${status}`;
  }
  return '';
}

/**
 * Observes one Zero instance. Safe to call again when the provider replaces the
 * instance (workspace switch, forced refresh) — the previous subscription is
 * disposed first so a stale client cannot keep writing connection events.
 */
export function attachZeroDiagnostics(zero: unknown): void {
  detachZeroDiagnostics();

  const source = zero as ZeroConnectionSource;
  const state = source.connection?.state;
  if (!state) return;

  const publish = (next: { name: string; reason?: unknown }): void => {
    diagnosticsStore.recordConnectionState(
      toConnectionName(next.name),
      describeReason(next.reason),
    );
  };

  publish(state.current);
  const unsubscribeState = state.subscribe(publish);

  const unsubscribePending = subscribePendingMutations(count => {
    diagnosticsStore.setPendingMutations(count);
  });

  const timer = setInterval(() => diagnosticsStore.refreshConnectionMetrics(), REFRESH_MS);

  detachCurrent = () => {
    unsubscribeState();
    unsubscribePending();
    clearInterval(timer);
  };
}

export function detachZeroDiagnostics(): void {
  detachCurrent?.();
  detachCurrent = null;
}
