import { useEffect, useState } from 'react';
import { useConnectionState } from '@rocicorp/zero/react';
import { useZero } from '../hooks/useZero.js';
import { useQuery } from '../hooks/useQuery.js';
import { queries } from '../zero/queries.js';
import {
  firePendingMutator,
  getAllPending,
  isAutoRetryEligible,
  removePending,
  subscribePending,
} from './pending.js';

/**
 * Mount once (e.g. inside InitialStateLoader). Runs two side effects:
 *   - Live reconcile via `messagesByIds`: any pending id the server confirms
 *     with `isSent === true` is removed from MMKV.
 *   - Auto-retry: on any transition to `connected`, fires mutators for
 *     eligible pending entries (queued while `connecting`, not yet attempted).
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
}
