import { useEffect, useRef } from 'react';
import { useSelector } from '@xstate/react';
import { useSearchParams } from 'react-router-dom';
import { ConnectionState } from 'livekit-client';
import { roomActor } from '../machines/roomMachine';
import { useCachedQuery } from './useCachedQuery';
import { queries } from '../zero/queries';
import { useCallJoinOrInitiate } from './useCallJoinOrInitiate';
import { useAuth } from './useAuth';
import { useCallAutoJoinEnabled } from './callAutoJoinCacConfig';
import {
  isAutoJoinRequested,
  parseCallUrlOverrides,
  type CallUrlOverrides,
} from '../utils/callUrlOverrides';
import { CallOrigin } from '@xyne/shared';

const RETRY_MIN_MS = 3000;
const RETRY_MAX_MS = 30000;

interface AutoJoinCall {
  externalId?: string;
  callOrigin?: CallOrigin;
}

interface UseCallAutoJoinOptions {
  channelId: string;
  isMember: boolean;
}

/**
 * Call URL API: lets an external system drive a call by navigating to a channel
 * URL, with no bespoke integration on either side. Built for always-on room
 * stations (a machine that should hold one channel's call open indefinitely and
 * recover on its own), but nothing here is specific to that.
 *
 * Query params on the channel URL, all opt-in:
 *
 *   ?autoJoin=1            join this channel's active call, or start one if there
 *                          isn't one, and keep retrying with backoff if dropped
 *   &mic=on|off            initial mic state, overriding the saved join preference
 *   &camera=on|off         initial camera state, likewise
 *   &telepresence=1        start the call already in presentation (telepresence)
 *                          mode. Subject to its own existing gate — the call view
 *                          honours it only for users the xyne_telepresence_config
 *                          CAC flag already allows, so this param cannot be used
 *                          to reach the feature without that permission. This is
 *                          also how an unattended display fills the screen —
 *                          PresentationModeOverlay covers the viewport from either
 *                          call layout, so there is no layout param to set.
 *
 * Deliberately no fullscreen param: the DOM Fullscreen API needs a user gesture,
 * which an unattended display has nobody to provide. Filling the screen is the
 * launcher's job instead — a browser started with `--kiosk`, or a window manager
 * rule — and that hides the browser chrome too, which the DOM API cannot.
 *
 * Everything is gated on the `call_auto_join_config` CAC flag, twice: here, which
 * stops a URL-driven join from starting, and again in roomMachine at the point an
 * override is applied, so the machine never has to trust its input. Turning the
 * flag off stops new joins and retries; it does not end a call already in
 * progress. No-ops entirely for URLs that don't carry these params.
 */
export const useCallAutoJoin = ({ channelId, isMember }: UseCallAutoJoinOptions): void => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isFeatureEnabled = useCallAutoJoinEnabled(user?.email);

  const autoJoin = isFeatureEnabled && isMember && isAutoJoinRequested(searchParams);

  // Serialised so the effect below can depend on the overrides by value —
  // parseCallUrlOverrides builds a fresh object on every render.
  const callUrlOverridesKey = JSON.stringify(parseCallUrlOverrides(searchParams));

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

    // A channel can hold several active calls at once, differing by origin: one
    // CHANNEL call, one CONVERSATION call per thread, plus calendar-linked ones.
    // Match CHANNEL explicitly rather than excluding CONVERSATION — the query is
    // ordered newest-first, so "anything but a thread call" would follow a
    // calendar call that started after the channel's own call and join the wrong
    // one. CHANNEL is also exactly what the backend converges on when initiating
    // (findActiveCallByChannelId), so client and server agree on which call this is.
    const calls = (activeCalls ?? []) as readonly AutoJoinCall[];
    const channelCall = calls.find(call => call.callOrigin === CallOrigin.CHANNEL);

    if (isInCall) {
      if (channelCall && currentCallId === channelCall.externalId) {
        retryAttemptsRef.current = 0;
      }
      return undefined;
    }

    const attempt = retryAttemptsRef.current;
    const delay = attempt === 0 ? 0 : Math.min(RETRY_MIN_MS * 2 ** (attempt - 1), RETRY_MAX_MS);

    // The same setup is passed on every retry, not just the first join: each
    // attempt is a fresh JOIN_CALL/INITIATE_CALL into a machine whose context was
    // cleared on disconnect, so the station comes back with the mic and camera it
    // was asked for rather than drifting to defaults after one blip.
    const callSetup = {
      callUrlOverrides: JSON.parse(callUrlOverridesKey) as CallUrlOverrides,
    };

    const timer = setTimeout(() => {
      retryAttemptsRef.current = attempt + 1;
      if (channelCall?.externalId) {
        joinCall({ callId: channelCall.externalId, ...callSetup });
      } else {
        initiateCall({ channelId, ...callSetup });
      }
    }, delay);

    return (): void => clearTimeout(timer);
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
    callUrlOverridesKey,
  ]);
};
