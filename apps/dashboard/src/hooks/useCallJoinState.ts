import { useEffect, useRef, useCallback, useState } from 'react';
import { useSelector } from '@xstate/react';
import { InvitationResponse } from '@xyne/shared';
import { roomActor } from '../machines/roomMachine';
import { openJoinCallWindow, shouldUseCallWindow } from '../routes/CallWindow/callWindowLauncher';
import { useZero } from './useZero';
import { usePlatform } from './usePlatform';
import { getUserCallAccessLevel } from './useCalls';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';
import { logger, Event } from '../utils/logger';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type CallJoinAction = 'canJoin' | 'requested' | 'requestToJoin';

interface CallJoinState {
  /** What UI the user should see */
  action: CallJoinAction;
  /** Fire to request access to the call */
  requestToJoin: () => void;
  cancelJoinRequest: () => void;
  /** True while the mutation is in flight */
  isRequesting: boolean;
  isCancellingRequest: boolean;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

interface ParticipantLike {
  userId: string;
  response?: string | null;
  invitedAt?: number | null;
  respondedAt?: number | null;
}

interface CallLike {
  id?: string;
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

const CONSUMED_AUTO_JOIN_REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_CONSUMED_AUTO_JOIN_REQUEST_KEYS = 200;
const consumedAutoJoinRequestKeys = new Map<string, number>();

function pruneConsumedAutoJoinRequestKeys(now = Date.now()): void {
  for (const [key, consumedAt] of consumedAutoJoinRequestKeys) {
    if (now - consumedAt > CONSUMED_AUTO_JOIN_REQUEST_TTL_MS) {
      consumedAutoJoinRequestKeys.delete(key);
    }
  }

  while (consumedAutoJoinRequestKeys.size > MAX_CONSUMED_AUTO_JOIN_REQUEST_KEYS) {
    const oldestKey = consumedAutoJoinRequestKeys.keys().next().value;
    if (!oldestKey) return;
    consumedAutoJoinRequestKeys.delete(oldestKey);
  }
}

function hasConsumedAutoJoinRequestKey(key: string): boolean {
  pruneConsumedAutoJoinRequestKeys();
  return consumedAutoJoinRequestKeys.has(key);
}

function markAutoJoinRequestKeyConsumed(key: string): void {
  consumedAutoJoinRequestKeys.set(key, Date.now());
  pruneConsumedAutoJoinRequestKeys();
}

function getAutoJoinRequestKey(
  callId: string,
  userId: string | undefined,
  participant: ParticipantLike | null,
): string | null {
  const requestedAt = participant?.respondedAt ?? participant?.invitedAt ?? null;
  return callId && userId && requestedAt ? `${callId}:${userId}:${requestedAt}` : null;
}

function getAcceptedAutoJoinRequestKey(
  previousResponse: string | null,
  currentResponse: string | null,
  pendingRequestKey: string | undefined | null,
): string | null {
  return previousResponse === InvitationResponse.REQUESTED &&
    currentResponse === InvitationResponse.ACCEPTED &&
    pendingRequestKey
    ? pendingRequestKey
    : null;
}

function consumeAutoJoinRequestKey(requestKey: string): boolean {
  if (hasConsumedAutoJoinRequestKey(requestKey)) return false;
  markAutoJoinRequestKeyConsumed(requestKey);
  return true;
}

function sendJoinCall(callId: string, zero: ReturnType<typeof useZero>, isMobile: boolean): void {
  if (shouldUseCallWindow(isMobile)) {
    openJoinCallWindow(callId);
    return;
  }
  roomActor.send({
    type: 'JOIN_CALL',
    callId,
    zero,
    viewMode: isMobile ? 'full' : 'mini',
  });
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
  const participant = call?.participants?.find(p => p.userId === userId) ?? null;
  const currentResponse = participant?.response ?? null;
  const requestKey = getAutoJoinRequestKey(callId, userId, participant);
  const pendingRequestKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (currentResponse === InvitationResponse.REQUESTED) {
      pendingRequestKeyRef.current = requestKey;
    }

    const approvalRequestKey = pendingRequestKeyRef.current;
    const acceptedRequestKey = getAcceptedAutoJoinRequestKey(
      prevResponseRef.current,
      currentResponse,
      approvalRequestKey,
    );

    if (
      acceptedRequestKey &&
      !isUserInCall &&
      callId &&
      consumeAutoJoinRequestKey(acceptedRequestKey)
    ) {
      pendingRequestKeyRef.current = null;
      sendJoinCall(callId, zero, isMobile);
    }

    prevResponseRef.current = currentResponse;
  }, [currentResponse, requestKey, callId, isUserInCall, zero, isMobile]);
}

export function useGlobalAutoJoinOnAccept(userId: string | undefined): void {
  const zero = useZero();
  const { isMobile } = usePlatform();
  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const currentCallId = useSelector(roomActor, state => state.context.externalId);
  const isRoomBusy = useSelector(
    roomActor,
    state =>
      state.matches('initiating') ||
      state.matches('joining') ||
      state.matches('connecting') ||
      state.matches('connected') ||
      state.matches('disconnecting'),
  );

  const prevResponsesRef = useRef<Map<string, string | null>>(new Map());
  const pendingRequestKeysRef = useRef<Map<string, string>>(new Map());
  const pendingAutoJoinCallIdRef = useRef<string | null>(null);
  useEffect(() => {
    const pendingCallId = pendingAutoJoinCallIdRef.current;
    if (!pendingCallId || isRoomBusy) return;

    pendingAutoJoinCallIdRef.current = null;
    sendJoinCall(pendingCallId, zero, isMobile);
  }, [isRoomBusy, zero, isMobile]);

  useEffect(() => {
    if (!userId) return;

    const activeCallIds = new Set<string>();

    (activeCalls as CallLike[]).forEach(call => {
      const callId = call.externalId;
      if (!callId) return;
      activeCallIds.add(callId);

      const participant = call.participants?.find(p => p.userId === userId) ?? null;
      const currentResponse = participant?.response ?? null;
      const previousResponse = prevResponsesRef.current.get(callId) ?? null;
      const requestKey = getAutoJoinRequestKey(callId, userId, participant);

      if (currentResponse === InvitationResponse.REQUESTED && requestKey) {
        pendingRequestKeysRef.current.set(callId, requestKey);
      }

      const acceptedRequestKey = getAcceptedAutoJoinRequestKey(
        previousResponse,
        currentResponse,
        pendingRequestKeysRef.current.get(callId),
      );
      if (acceptedRequestKey && consumeAutoJoinRequestKey(acceptedRequestKey)) {
        pendingRequestKeysRef.current.delete(callId);

        if (currentCallId !== callId) {
          if (isRoomBusy) {
            pendingAutoJoinCallIdRef.current = callId;
            roomActor.send({ type: 'DISCONNECT' });
          } else {
            sendJoinCall(callId, zero, isMobile);
          }
        }
      } else if (currentResponse !== InvitationResponse.REQUESTED) {
        pendingRequestKeysRef.current.delete(callId);
      }

      prevResponsesRef.current.set(callId, currentResponse);
    });

    for (const callId of prevResponsesRef.current.keys()) {
      if (!activeCallIds.has(callId)) {
        prevResponsesRef.current.delete(callId);
        pendingRequestKeysRef.current.delete(callId);
      }
    }
  }, [activeCalls, currentCallId, isRoomBusy, userId, zero, isMobile]);
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
  const [isCancellingRequest, setIsCancellingRequest] = useState(false);

  const activeCalls = useSelector(roomActor, state => state.context.activeCalls);
  const call = findCall(activeCalls, callId);

  const userResponse = resolveUserResponse(call, userId);
  const action = getUserCallAccessLevel(call?.participants ?? [], userId);

  // We track isRequesting locally for optimistic UI feedback.
  // Once the mutation lands, the Zero query will update action → 'requested'.
  const isRequestingRef = useRef(false);
  const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (requestTimeoutRef.current) {
        clearTimeout(requestTimeoutRef.current);
      }
      if (cancelTimeoutRef.current) {
        clearTimeout(cancelTimeoutRef.current);
      }
    };
  }, []);

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
      logger.error(Event.ZERO_MUTATION_ERROR, {
        callId,
        context: 'useCallJoinState.requestToJoin',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Short timeout to allow the mutation to optimistically update before clearing
      if (requestTimeoutRef.current) {
        clearTimeout(requestTimeoutRef.current);
      }
      requestTimeoutRef.current = setTimeout(() => {
        isRequestingRef.current = false;
        requestTimeoutRef.current = null;
      }, 500);
    }
  }, [callId, userId, zero, action]);

  const cancelJoinRequest = useCallback(() => {
    if (!callId || !userId || !zero) return;
    if (userResponse !== InvitationResponse.REQUESTED) return;

    setIsCancellingRequest(true);
    try {
      zero.mutate(
        mutators.calls.cancelJoinRequest({
          callId,
          timestamp: Date.now(),
        }),
      );
    } catch (error) {
      logger.error(Event.ZERO_MUTATION_ERROR, {
        callId,
        context: 'useCallJoinState.cancelJoinRequest',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (cancelTimeoutRef.current) {
        clearTimeout(cancelTimeoutRef.current);
      }
      cancelTimeoutRef.current = setTimeout(() => {
        setIsCancellingRequest(false);
        cancelTimeoutRef.current = null;
      }, 500);
    }
  }, [callId, userId, zero, userResponse]);

  return {
    action,
    requestToJoin,
    cancelJoinRequest,
    isRequesting: isRequestingRef.current || userResponse === InvitationResponse.REQUESTED,
    isCancellingRequest,
  };
}
