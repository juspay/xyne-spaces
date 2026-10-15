import { CallStatus, InvitationResponse } from '@xyne/shared';

import type { RingingCall } from '@/src/services/CallKit.types';

/**
 * How long a ring must have been showing before Zero's word on it is trusted.
 * Covers the gap between the push that rang and the invite row syncing in.
 */
export const RING_RECONCILE_GRACE_MS = 4_000;

export interface RingReconcileParticipant {
  userId: string;
  response: string | null;
  leftAt?: number | null;
}

export interface RingReconcileCall {
  externalId: string;
  status?: string;
  participants?: readonly RingReconcileParticipant[] | null;
}

/** Backend-style dismiss reasons, as consumed by resolveCallEndReason(). */
export type RingEndReason = 'answered' | 'declined' | 'missed' | 'ended';

export interface RingVerdict {
  callId: string;
  reason: RingEndReason;
}

/**
 * Rings that Zero says are over. Push delivery of CALL_DISMISS / MISSED_CALL is
 * best-effort — FCM can reject a send, a visible push never reaches a
 * backgrounded app — so the synced call rows are the last word.
 *
 * Conservative by construction: a ring is ended only when its call is present
 * in a complete result and that row says the invite is no longer pending. A call
 * Zero cannot see yields no verdict, so a legitimate ring is never cut short on
 * missing data.
 */
export function findRingsToEnd(params: {
  ringing: readonly RingingCall[];
  /** Rows from complete query results only. */
  calls: readonly RingReconcileCall[];
  userId: string;
  now: number;
}): RingVerdict[] {
  const verdicts: RingVerdict[] = [];

  for (const ring of params.ringing) {
    if (ring.displayedAt <= 0 || params.now - ring.displayedAt < RING_RECONCILE_GRACE_MS) {
      continue;
    }
    const call = params.calls.find(candidate => String(candidate.externalId) === ring.callId);
    if (!call) {
      continue;
    }
    const reason = reasonToEndRing(call, params.userId);
    if (reason) {
      verdicts.push({ callId: ring.callId, reason });
    }
  }

  return verdicts;
}

function reasonToEndRing(call: RingReconcileCall, userId: string): RingEndReason | null {
  if (call.status === CallStatus.ENDED || call.status === CallStatus.CANCELLED) {
    return 'ended';
  }
  if (!Array.isArray(call.participants)) {
    // Relation not loaded: no verdict.
    return null;
  }
  const me = call.participants.find(participant => participant.userId === userId);
  if (!me) {
    // The call goes on without this user: the invite was withdrawn.
    return 'ended';
  }
  if (me.response === null) {
    // No response recorded yet: not a verdict either way.
    return null;
  }
  if (
    me.response === InvitationResponse.INVITED &&
    (me.leftAt === null || me.leftAt === undefined)
  ) {
    return null;
  }
  switch (me.response) {
    case InvitationResponse.ACCEPTED:
      return 'answered';
    case InvitationResponse.DECLINED:
      return 'declined';
    case InvitationResponse.MISSED:
      return 'missed';
    default:
      return 'ended';
  }
}
