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
  updatePending,
  SEND_CONFIRMATION_GRACE_MS,
} from './pending.js';

/** How often the grace window is re-checked while entries are outstanding. */
const FAILURE_SWEEP_INTERVAL_MS = 15_000;

/**
 * Mount once (e.g. inside InitialStateLoader). Runs three side effects:
 *   - Live reconcile via `messagesByIds`: any pending id the server confirms
 *     with `isSent === true` is removed. This is the ONLY path that removes an
 *     entry. A successful optimistic apply must never remove one — the server
 *     can still reject or retry the mutation, and removing on client apply
 *     loses the message when it does.
 *   - Failure marking: once that query reports `complete` — the server has
 *     authoritatively answered — an entry still carrying no `isSent` row past
 *     SEND_CONFIRMATION_GRACE_MS is marked failed, so the UI offers a manual
 *     retry instead of showing it as though it were on its way.
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

  const [reconcileRows, reconcileDetails] = useQuery(
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

  // The grace window expires on a clock, so re-evaluate periodically while
  // anything is outstanding; reacting to the query alone would only re-run the
  // check when its rows change, which a stuck send never causes.
  const [sweepTick, setSweepTick] = useState(0);
  useEffect(() => {
    if (pendingIds.length === 0) return;
    const timer = setInterval(
      () => setSweepTick(tick => tick + 1),
      FAILURE_SWEEP_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [pendingIds.length]);

  const reconcileType = reconcileDetails.type;
  useEffect(() => {
    // Only `complete` is evidence: it means the server answered this query, so
    // a missing or unsent row is a real answer rather than "we haven't heard
    // back yet". On `unknown` / `error` the entry is left alone.
    if (reconcileType !== 'complete') return;
    const confirmed = new Set(
      (reconcileRows ?? [])
        .filter(row => row.isSent && row.messageId)
        .map(row => row.messageId),
    );
    const now = Date.now();
    for (const entry of getAllPending()) {
      if (entry.sendFailed || entry.mutatorAppError) continue;
      // Queued but never attempted — the auto-retry effect below owns it.
      if (!entry.mutatorFired) continue;
      if (confirmed.has(entry.messageId)) continue;
      if (now - entry.timestamp < SEND_CONFIRMATION_GRACE_MS) continue;
      updatePending(entry.messageId, { sendFailed: true });
    }
  }, [reconcileType, reconcileRows, sweepTick]);

  const connectionStateName = useConnectionState().name;
  useEffect(() => {
    if (connectionStateName !== 'connected') return;
    for (const entry of getAllPending()) {
      if (!isAutoRetryEligible(entry)) continue;
      firePendingMutator(zero, entry);
    }
  }, [zero, connectionStateName]);
}
