import { useEffect, useState } from 'react';
import { useConnectionState } from '@rocicorp/zero/react';
import { useZero } from '../hooks/useZero.js';
import { useQuery } from '../hooks/useQuery.js';
import { queries } from '../zero/queries.js';
import {
  firePendingMutator,
  getAllPending,
  isAutoRetryEligible,
  notifyPendingSubscribers,
  removePending,
  subscribePending,
} from './pending.js';

/** How often the stuck-send sweep re-evaluates pending entries. */
const SWEEP_INTERVAL_MS = 5_000;

/**
 * Mount once (e.g. inside InitialStateLoader). Runs two side effects:
 *   - Live reconcile via `messagesByIds`: any pending id the server confirms
 *     with `isSent === true` is removed from MMKV.
 *   - Auto-retry: on any transition to `connected`, fires mutators for
 *     eligible pending entries — both sends queued while offline and sends that
 *     were fired while `connected` but never acknowledged (socket died or the
 *     client group was rebuilt mid-flight).
 *   - Stuck-send sweep: a timer re-notifies subscribers so an unacknowledged
 *     send flips to the `failed` UI once it passes `SEND_ACK_TIMEOUT_MS`, and
 *     retries it if the connection is healthy again.
 */
export function usePendingQueue(): void {
  const zero = useZero();

  const [pendingIds, setPendingIds] = useState<string[]>(() =>
    getAllPending().map(p => p.messageId),
  );
  useEffect(
    () =>
      subscribePending(() => {
        setPendingIds(getAllPending().map(p => p.messageId));
      }),
    [],
  );

  const [reconcileRows] = useQuery(
    queries.messagesByIds({ messageIds: pendingIds }),
    { enabled: pendingIds.length > 0 },
  );
  useEffect(() => {
    if (!reconcileRows) return;
    for (const row of reconcileRows) {
      if (row.isSent && row.messageId) {
        removePending(row.messageId);
      }
    }
  }, [reconcileRows]);

  const connectionStateName = useConnectionState().name;
  useEffect(() => {
    if (connectionStateName !== 'connected') return;
    for (const entry of getAllPending()) {
      if (!isAutoRetryEligible(entry)) continue;
      firePendingMutator(zero, entry);
    }
  }, [zero, connectionStateName]);

  useEffect(() => {
    const interval = setInterval(() => {
      const entries = getAllPending();
      if (entries.length === 0) return;
      // Status is time-dependent; re-notify so an overdue send repaints as failed.
      notifyPendingSubscribers();
      if (zero.connection.state.current.name !== 'connected') return;
      for (const entry of entries) {
        if (!isAutoRetryEligible(entry)) continue;
        firePendingMutator(zero, entry);
      }
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [zero]);
}
