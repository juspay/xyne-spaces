import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { useSearchParams } from 'react-router-dom';
import { ConnectionState } from 'livekit-client';
import { roomActor } from '../machines/roomMachine';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useCallJoinOrInitiate } from './useCallJoinOrInitiate';
import { CallOrigin } from '@xyne/shared';

const RETRY_MIN_MS = 3000;
const RETRY_MAX_MS = 30000;

interface AutoHuddleCall {
  externalId?: string;
  callOrigin?: CallOrigin;
}

interface UseAutoHuddleJoinerOptions {
  channelId: string;
  isMember: boolean;
}

/**
 * Telepresence-only behavior, opt in via `?autoJoinHuddle=1` on the channel URL (used by
 * dedicated meeting-room machines that keep one channel's huddle permanently occupied).
 * Joins the channel's active call if one exists, starts one otherwise, and retries
 * with backoff if disconnected. No-ops for every other URL.
 */
export const useAutoHuddleJoiner = ({ channelId, isMember }: UseAutoHuddleJoinerOptions): void => {
  const [searchParams] = useSearchParams();
  const autoJoin = isMember && searchParams.get('autoJoinHuddle') === '1';

  const [activeCalls] = useCachedQuery(queries.activeCallsInChannel({ channelId }));
  const stateSnapshot = useSelector(roomActor, state => state);
  const machineState = stateSnapshot.value;
  const currentCallId = stateSnapshot.context.externalId;
  const isInCall =
    stateSnapshot.matches('initiating') ||
    stateSnapshot.matches('joining') ||
    stateSnapshot.matches('connecting') ||
    stateSnapshot.matches('connected');

  // roomMachine only leaves the 'connected' state for two specific LiveKit disconnect
  // reasons (host ended call, evicted by another device) — a generic network-caused
  // disconnect (signal close, reconnect timeout) leaves the machine reporting
  // 'connected' indefinitely, since it's designed to let LiveKit's own client-side
  // reconnection handle transient blips silently. Confirmed by testing: once
  // LiveKit's own reconnect attempts exhaust, the machine gets stuck reporting
  // 'connected' with a dead room forever.
  //
  // Read the LiveKit Room object's own `.state` directly rather than
  // context.connectionState: that context field is only ever updated by the
  // CONNECTION_STATE_CHANGED event handler (roomEventListener), which is registered
  // *after* room.connect() has already resolved — essentially the same moment the
  // first Connected event fires — so that first event is structurally missed and
  // connectionState can stay stuck at its stale 'disconnected' default for the
  // entire life of a healthy call that never has an intermediate reconnect blip
  // (confirmed by testing). room.state has no such gap — it's a live property read,
  // always accurate regardless of which events our listener did or didn't catch.
  const isStuckAfterFailedReconnect =
    stateSnapshot.matches('connected') &&
    stateSnapshot.context.room?.state === ConnectionState.Disconnected;

  const { joinCall, initiateCall } = useCallJoinOrInitiate();

  const retryAttemptsRef = useRef(0);

  useEffect(() => {
    if (!autoJoin) return undefined;

    if (isStuckAfterFailedReconnect) {
      roomActor.send({ type: 'DISCONNECT' });
      return undefined;
    }

    const calls = (activeCalls ?? []) as readonly AutoHuddleCall[];
    const channelCall = calls.find(call => call.callOrigin !== CallOrigin.CONVERSATION);

    if (isInCall) {
      if (channelCall && currentCallId === channelCall.externalId) {
        retryAttemptsRef.current = 0;
      }
      return undefined;
    }

    const attempt = retryAttemptsRef.current;
    const delay = attempt === 0 ? 0 : Math.min(RETRY_MIN_MS * 2 ** (attempt - 1), RETRY_MAX_MS);

    const timer = setTimeout(() => {
      retryAttemptsRef.current = attempt + 1;
      if (channelCall?.externalId) {
        joinCall({ callId: channelCall.externalId });
      } else {
        initiateCall({ channelId });
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [
    autoJoin,
    activeCalls,
    isInCall,
    isStuckAfterFailedReconnect,
    currentCallId,
    channelId,
    joinCall,
    initiateCall,
    machineState,
  ]);
};
