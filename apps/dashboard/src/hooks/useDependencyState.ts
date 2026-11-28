import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import posthog from 'posthog-js';
import type { DependencyState } from '@xyne/shared';
import { useAuth } from './useAuth';
import { posthogService } from '../services/Analytics/posthogService';
import { DependencyBatchStore } from '../services/dependencies/store';
import { dependencyApi, subscribeDependencyInvalidation } from '../services/dependencies/api';
import type { DependencyTicketView } from '../services/dependencies/types';

const EMPTY: ReadonlyMap<string, DependencyTicketView> = new Map();
const emptySnapshot = () => EMPTY;
const noSubscribe = () => () => {};
interface StoreEntry {
  store: DependencyBatchStore;
  users: number;
  timer: number | null;
  stop: (() => void) | null;
}
const stores = new Map<string, StoreEntry>();

export function useTicketDependenciesEnabled(): boolean {
  const [enabled, setEnabled] = useState(() =>
    posthogService.isFeatureEnabled('ticket_dependencies_v1'),
  );
  useEffect(
    () =>
      posthog.onFeatureFlags(() => {
        setEnabled(posthogService.isFeatureEnabled('ticket_dependencies_v1'));
      }),
    [],
  );
  return enabled;
}

export function useDependencyData(
  ticketIds: readonly string[],
): ReadonlyMap<string, DependencyTicketView> {
  const { user, isAuthenticated } = useAuth();
  const enabled = useTicketDependenciesEnabled();
  const scope = enabled && isAuthenticated && user ? JSON.stringify([user.workspaceId, user.id]) : null;
  const key = JSON.stringify([...new Set(ticketIds.filter(Boolean))].sort());
  const ids = useMemo(() => JSON.parse(key) as string[], [key]);
  const entry = useMemo(() => {
    if (!scope) return null;
    let existing = stores.get(scope);
    if (!existing) {
      existing = {
        store: new DependencyBatchStore((ids, signal) => dependencyApi.read(ids, signal)),
        users: 0,
        timer: null,
        stop: null,
      };
      stores.set(scope, existing);
    }
    return existing;
  }, [scope]);
  const data = useSyncExternalStore(
    entry?.store.subscribe ?? noSubscribe,
    entry?.store.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  useEffect(() => {
    if (!entry || !scope) return;
    entry.users++;
    const release = entry.store.retain(ids);
    if (entry.timer === null) {
      const removeInvalidation = subscribeDependencyInvalidation(entry.store.refresh);
      const refresh = () => {
        if (!document.hidden) entry.store.refresh();
      };
      // One timer per identity. BLOCKS deliberately does not use raw Zero sync.
      entry.timer = window.setInterval(refresh, 5_000);
      window.addEventListener('focus', refresh);
      window.addEventListener('online', refresh);
      document.addEventListener('visibilitychange', refresh);
      entry.stop = () => {
        removeInvalidation();
        window.removeEventListener('focus', refresh);
        window.removeEventListener('online', refresh);
        document.removeEventListener('visibilitychange', refresh);
      };
    }
    return () => {
      release();
      entry.users--;
      // React StrictMode replays effects. Dispose only when no consumer reattaches.
      queueMicrotask(() => {
        if (entry.users) return;
        if (entry.timer !== null) window.clearInterval(entry.timer);
        entry.timer = null;
        entry.stop?.();
        entry.stop = null;
        entry.store.dispose();
        if (stores.get(scope) === entry) stores.delete(scope);
      });
    };
  }, [entry, scope, ids]);
  return data;
}

export function useDependencyState(ticketIds: readonly string[]): Map<string, DependencyState> {
  const data = useDependencyData(ticketIds);
  const key = JSON.stringify(ticketIds);
  return useMemo(() => {
    const result = new Map<string, DependencyState>();
    for (const id of JSON.parse(key) as string[]) {
      const batch = data.get(id)?.batch;
      const state = batch?.states[id];
      if (!batch || !state) continue;
      const edges = new Map(batch.edges.map(edge => [edge.id, edge]));
      result.set(id, {
        primary: state.primary,
        blockedBy: state.blockedBy.flatMap(edgeId => edges.get(edgeId) ?? []),
        blocking: state.blocking.flatMap(edgeId => edges.get(edgeId) ?? []),
        ...(state.atRiskDays === undefined ? {} : { atRiskDays: state.atRiskDays }),
      });
    }
    return result;
  }, [data, key]);
}
