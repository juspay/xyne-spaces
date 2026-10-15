import { useEffect } from 'react';

import { useQuery } from '@/src/hooks/useQuery';
import { callKitService } from '@/src/services/CallKitService';
import { queries } from '@/src/zero/queries';

import { dismissIncomingCall } from './callActions';
import { findRingsToEnd, type RingReconcileCall } from './ringReconcile';

/** Re-check cadence: a ring younger than the grace period needs a later look. */
const RING_RECONCILE_INTERVAL_MS = 2_000;
/** Enough recent calls to always include the one ringing now. */
const RECENT_CALLS_LIMIT = 10;

/**
 * Ends the system ring (CallKit / Telecom) for a call Zero says is over —
 * answered or declined elsewhere, cancelled by the caller, ended — whether or
 * not the CALL_DISMISS / MISSED_CALL push ever arrived. See ringReconcile.ts
 * for the rules; the dismissal itself goes through dismissIncomingCall, which
 * never touches a call this device is joining or in.
 */
export function useRingReconcile(params: {
  activeCalls: readonly RingReconcileCall[] | undefined;
  activeCallsComplete: boolean;
  userId: string | undefined;
}): void {
  const { activeCalls, activeCallsComplete, userId } = params;
  // userCallHistory keeps ENDED calls, which userActiveCalls drops — a cancelled
  // call must be seen as ended, not merely missing.
  const [recentCalls, recentCallsDetails] = useQuery(
    queries.userCallHistory({ limit: RECENT_CALLS_LIMIT, start: null }),
  );
  const recentCallsComplete = recentCallsDetails.type === 'complete';

  useEffect(() => {
    if (!userId) return;
    const calls: RingReconcileCall[] = [
      ...(activeCallsComplete ? (activeCalls ?? []) : []),
      ...(recentCallsComplete ? (recentCalls ?? []) : []),
    ];
    if (calls.length === 0) return;

    const reconcile = (): void => {
      const ringing = callKitService.getRingingCalls();
      if (ringing.length === 0) return;
      for (const verdict of findRingsToEnd({ ringing, calls, userId, now: Date.now() })) {
        void dismissIncomingCall(verdict.callId, {
          type: 'CALL_DISMISS',
          reason: verdict.reason,
          source: 'sync',
        });
      }
    };

    reconcile();
    const timer = setInterval(reconcile, RING_RECONCILE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeCalls, activeCallsComplete, recentCalls, recentCallsComplete, userId]);
}
