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
import { CallOrigin } from '@xyne/shared';

const RETRY_MIN_MS = 3000;
const RETRY_MAX_MS = 30000;

/**
 * The call URL API's query-parameter names. Exported because this is a public
 * contract — anything constructing these URLs (deep links, an unattended room
 * station's launcher) should reference these rather than re-spelling them, since
 * a typo here fails silently: the param is simply ignored.
 */
export const CALL_URL_PARAMS = {
  autoJoin: 'autoJoin',
  /** Pre-existing spelling, still baked into deployed station deep links. */
  autoJoinLegacy: 'autoJoinHuddle',
  mic: 'mic',
  camera: 'camera',
  viewMode: 'viewMode',
  fullscreen: 'fullscreen',
} as const;

/** Value that turns on the flag-style params (`autoJoin`, `fullscreen`). */
const FLAG_ON = '1';

interface AutoJoinCall {
  externalId?: string;
  callOrigin?: CallOrigin;
}

interface UseCallAutoJoinOptions {
  channelId: string;
  isMember: boolean;
}

/** `on`/`off` -> boolean; anything else (including absent) -> undefined = "not requested". */
const parseOnOff = (value: string | null): boolean | undefined =>
  value === 'on' ? true : value === 'off' ? false : undefined;

/** Anything but the two known layouts -> undefined, leaving the app's own default. */
const parseViewMode = (value: string | null): 'full' | 'mini' | undefined =>
  value === 'full' || value === 'mini' ? value : undefined;

/**
 * Ask the shell for real fullscreen. In Electron this goes through the main
 * process (BrowserWindow.setFullScreen), which — unlike the DOM Fullscreen API —
 * needs no user gesture, so it works on an unattended machine that nobody is
 * clicking. The DOM call is the browser fallback; it can legitimately reject
 * without prior user activation, hence the swallowed rejection.
 */
const requestShellFullscreen = (): void => {
  const setWindowFullscreen = window.electronAPI?.setWindowFullscreen;
  if (setWindowFullscreen) {
    setWindowFullscreen(true);
    return;
  }
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen().catch(() => {});
  }
};

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
 *   &viewMode=full|mini    call UI layout (default: platform-derived, mini on desktop)
 *   &fullscreen=1          put the window into fullscreen once connected
 *
 * `?autoJoinHuddle=1` is accepted as an alias for `?autoJoin=1` — it's what the
 * already-deployed stations have baked into their deep links.
 *
 * Everything is gated on the `call_auto_join_config` CAC flag; while that is off
 * these params are inert. No-ops entirely for URLs that don't carry them.
 */
export const useCallAutoJoin = ({ channelId, isMember }: UseCallAutoJoinOptions): void => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const isFeatureEnabled = useCallAutoJoinEnabled(user?.email);

  const autoJoinRequested =
    searchParams.get(CALL_URL_PARAMS.autoJoin) === FLAG_ON ||
    searchParams.get(CALL_URL_PARAMS.autoJoinLegacy) === FLAG_ON;
  const autoJoin = isFeatureEnabled && isMember && autoJoinRequested;

  const micParam = parseOnOff(searchParams.get(CALL_URL_PARAMS.mic));
  const cameraParam = parseOnOff(searchParams.get(CALL_URL_PARAMS.camera));
  const viewMode = parseViewMode(searchParams.get(CALL_URL_PARAMS.viewMode));
  const wantsFullscreen = searchParams.get(CALL_URL_PARAMS.fullscreen) === FLAG_ON;

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

    const calls = (activeCalls ?? []) as readonly AutoJoinCall[];
    const channelCall = calls.find(call => call.callOrigin !== CallOrigin.CONVERSATION);

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
    // cleared on disconnect, so the station comes back with the mic, camera and
    // layout it was asked for rather than drifting to defaults after one blip.
    const callSetup = {
      ...(viewMode && { viewMode }),
      ...(micParam !== undefined && { initialMicEnabled: micParam }),
      ...(cameraParam !== undefined && { initialCameraEnabled: cameraParam }),
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
    viewMode,
    micParam,
    cameraParam,
  ]);

  // Fullscreen is a shell-level concern, so unlike mic/camera it can't ride along
  // on the join event — it's applied once the call is actually up. Keyed on call
  // id so a rejoin after a drop re-applies it (a user may have escaped fullscreen
  // in between) while re-renders within one call don't.
  const fullscreenAppliedForCallRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoJoin || !wantsFullscreen) return;
    if (!stateSnapshot.matches('connected') || !currentCallId) return;
    if (fullscreenAppliedForCallRef.current === currentCallId) return;

    fullscreenAppliedForCallRef.current = currentCallId;
    requestShellFullscreen();
  }, [autoJoin, wantsFullscreen, stateSnapshot, currentCallId]);
};
