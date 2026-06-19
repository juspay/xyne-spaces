import { useEffect, useRef, useCallback } from 'react';
import { useSelector } from '@xstate/react';
import { InvitationResponse } from '@xyne/shared';
import { roomActor } from '../machines/roomMachine';
import { useZero } from './useZero';
import { usePlatform } from './usePlatform';
import { getUserCallAccessLevel } from './useCalls';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type CallJoinAction = 'canJoin' | 'requested' | 'requestToJoin';

interface CallJoinState {
  /** What UI the user should see */
  action: CallJoinAction;
  /** Fire to request access to the call */
  requestToJoin: () => void;
  /** True while the mutation is in flight */
  isRequesting: boolean;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

interface ParticipantLike {
  userId: string;
  response?: string | null;
}

interface CallLike {
  externalId?: string;
  participants?: ReadonlyArray<ParticipantLike>;
}

/** Find a call by externalId in the activeCalls array. */
function findCall(activeCalls: unknown, callId: string): CallLike | null {
  if (!activeCalls || !Array.isArray(activeCalls)) return null;
  return (activeCalls as CallLike[]).find(c => c.externalId === callId) ?? null;
}

/** Resolve the user's current response for a call. */
function resolveUserResponse(call: CallLike | null, userId: string | undefined): string | null {
  if (!call || !userId) return null;
  return call.participants?.find(p => p.userId === userId)?.response ?? null;
}

// ─────────────────────────────────────────────
// Hook 1: Auto-join when REQUESTED → ACCEPTED
// ─────────────────────────────────────────────

interface UseAutoJoinOnAcceptOptions {
  callId: string;
  userId: string | undefined;
  isUserInCall: boolean;
}

/**
 * Watches the current user's participant response for a call.
 * When it transitions from REQUESTED → ACCEPTED, auto-joins the call.
 */
export function useAutoJoinOnAccept({
  callId,
  userId,
  isUserInCall,
}: UseAutoJoinOnAcceptOptions): void {
  const zero = useZero();
  const { isMobile } = usePlatform();
  const prevResponseRef = useRef<string | null>(null);

  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const call = findCall(activeCalls, callId);
  const currentResponse = resolveUserResponse(call, userId);

  useEffect(() => {
    const wasRequested = prevResponseRef.current === InvitationResponse.REQUESTED;
    const isAccepted = currentResponse === InvitationResponse.ACCEPTED;

    if (wasRequested && isAccepted && !isUserInCall && callId) {
      roomActor.send({
        type: 'JOIN_CALL',
        callId,
        zero,
        viewMode: isMobile ? 'full' : 'mini',
      });
    }

    prevResponseRef.current = currentResponse;
  }, [currentResponse, callId, isUserInCall, zero, isMobile]);
}

// ─────────────────────────────────────────────
// Hook 2: Unified call join state
// ─────────────────────────────────────────────

/**
 * Returns everything a component needs to render the correct call action UI.
 *
 * - `action`: what button to show ('canJoin' | 'requested' | 'requestToJoin')
 * - `requestToJoin`: call this when the user clicks "Request to Join"
 * - `isRequesting`: true while the mutation is in flight
 */
export function useCallJoinState(callId: string, userId: string | undefined): CallJoinState {
  const zero = useZero();

  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const call = findCall(activeCalls, callId);

  const userResponse = resolveUserResponse(call, userId);
  const action = getUserCallAccessLevel(call?.participants ?? [], userId);

  // We track isRequesting locally for optimistic UI feedback.
  // Once the mutation lands, the Zero query will update action → 'requested'.
  const isRequestingRef = useRef(false);

  const requestToJoin = useCallback(() => {
    if (!callId || !userId || !zero) return;
    if (action !== 'requestToJoin') return;

    isRequestingRef.current = true;
    try {
      zero.mutate(
        mutators.calls.requestToJoin({
          callId,
          participantId: uuidv4(),
          timestamp: Date.now(),
        }),
      );
    } catch (error) {
      console.error('[useCallJoinState] Failed to request to join:', error);
    } finally {
      // Short timeout to allow the mutation to optimistically update before clearing
      setTimeout(() => {
        isRequestingRef.current = false;
      }, 500);
    }
  }, [callId, userId, zero, action]);

  return {
    action,
    requestToJoin,
    isRequesting: isRequestingRef.current || userResponse === InvitationResponse.REQUESTED,
  };
}
