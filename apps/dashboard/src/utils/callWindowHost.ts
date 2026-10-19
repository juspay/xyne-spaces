import { roomActor, type RoomContext } from '../machines/roomMachine';
import type {
  CallWindowCommand,
  CallWindowHandoff,
  CallWindowPhase,
  CallWindowStatus,
} from './callWindow';
import { logger, Event } from './logger';

/**
 * The call window's side of the handoff, run from main.tsx as soon as the
 * bundle loads — before React, auth, Zero or the initial state load.
 *
 * Connecting to LiveKit needs nothing but the token the main window already
 * fetched, so the room connects while the rest of the app boots, and the call
 * UI mounts onto an already-connected room instead of starting from scratch.
 */

// A join raised inside this window (e.g. a "Switch" on a call card) passes
// through idle on its way to the next call: the join is re-sent from a React
// effect right after idle, well inside this. Only an idle that lasts is the
// end, and "ended" closes the window, so keep it short.
const ENDED_SETTLE_MS = 250;

// What the Leave button does (CustomLiveKitRoom), for a leave asked for by
// closing the window. Unset while the call UI is not mounted.
let leaveHandler: (() => void) | null = null;

export const setCallWindowLeaveHandler = (handler: (() => void) | null): void => {
  leaveHandler = handler;
};

// The handoff this window is running.
let activeHandoffId: number | null = null;

// The user left the current call (Leave button, or closing the window), as
// opposed to leaving it for another call from here. Sent along with "ending"
// so Electron can take the window off screen at once.
let userLeftFor: number | null = null;

export const markCallWindowUserLeft = (): void => {
  userLeftFor = activeHandoffId;
};

let started = false;
// Waiting for the previous call to finish leaving before connecting the next.
// Only the latest handoff may wait: a newer one replaces an older waiter.
let waitForIdle: { unsubscribe: () => void } | null = null;

type SnapshotLike = {
  context: RoomContext;
  matches: (state: 'idle' | 'connected' | 'disconnecting') => boolean;
};

const phaseOf = (snapshot: SnapshotLike): CallWindowPhase | 'idle' => {
  if (snapshot.matches('idle')) return 'idle';
  if (snapshot.matches('connected')) return 'connected';
  if (snapshot.matches('disconnecting')) return 'ending';
  return 'connecting';
};

const buildStatus = (
  handoffId: number,
  phase: CallWindowPhase,
  context: RoomContext,
): CallWindowStatus => ({
  handoffId,
  phase,
  externalId: context.externalId,
  callId: context.callId,
  channelId: context.channelId,
  callType: context.callType,
  roomLink: context.roomLink,
  scopeType: context.scopeType,
  conversationId: context.conversationId,
  callStartTime: context.callStartTime,
  connectionState: context.connectionState,
  participants: context.participants.map(p => ({
    identity: p.identity,
    ...(p.name !== undefined && { name: p.name }),
    isCameraEnabled: p.isCameraEnabled,
    isMicrophoneEnabled: p.isMicrophoneEnabled,
    isScreenShareEnabled: p.isScreenShareEnabled,
    isLocal: p.isLocal,
  })),
  error: context.error,
  userLeft: phase === 'ending' && userLeftFor === handoffId,
});

const report = (status: CallWindowStatus): void => {
  window.electronAPI?.callWindow?.reportStatus(status as unknown as Record<string, unknown>);
};

/** Start the handed-off call, leaving whatever this window was still in. */
const connectHandoff = (handoff: CallWindowHandoff & { handoffId: number }): void => {
  activeHandoffId = handoff.handoffId;
  logger.info(Event.LIVEKIT_ROOM_EVENT, {
    callId: handoff.externalId,
    eventName: 'call_window_handoff_received',
    handoffId: handoff.handoffId,
  });

  const connect = (): void => {
    // Superseded while waiting: a newer handoff connects instead.
    if (activeHandoffId !== handoff.handoffId) return;
    // The machine only carries Zero along for later; connecting never uses it.
    roomActor.send({
      type: 'CONNECT',
      token: handoff.token,
      serverUrl: handoff.serverUrl,
      callType: handoff.callType,
      externalId: handoff.externalId,
      zero: null,
      handoff,
    });
    report(buildStatus(handoff.handoffId, 'connecting', roomActor.getSnapshot().context));
  };

  waitForIdle?.unsubscribe();
  waitForIdle = null;

  if (roomActor.getSnapshot().matches('idle')) {
    connect();
    return;
  }
  const subscription = roomActor.subscribe(state => {
    if (!state.matches('idle')) return;
    subscription.unsubscribe();
    if (waitForIdle === subscription) waitForIdle = null;
    connect();
  });
  waitForIdle = subscription;
  // Already leaving for an earlier handoff: one leave is enough.
  if (!roomActor.getSnapshot().matches('disconnecting')) {
    roomActor.send({ type: 'DISCONNECT' });
  }
};

const startHandoffIntake = (api: NonNullable<Window['electronAPI']>['callWindow']): void => {
  if (!api) return;
  // Main keeps the handoff readable until this window reports on it, and also
  // pings when one arrives. Listening before the first read closes the gap
  // where a handoff lands between the two; the id check makes repeats no-ops.
  const take = async (): Promise<void> => {
    const handoff = (await api.takeHandoff()) as (CallWindowHandoff & { handoffId: number }) | null;
    if (!handoff || typeof handoff.handoffId !== 'number') return;
    if (handoff.handoffId === activeHandoffId) return;
    connectHandoff(handoff);
  };
  api.onHandoffReady(() => void take());
  void take();
};

const startStatusReporter = (): void => {
  let lastSent = '';
  let endedTimer: ReturnType<typeof setTimeout> | null = null;
  let endedFor: number | null = null;
  // A call left from inside this window for another (e.g. "Switch" on a call
  // card) that has not connected yet. If it fails, the join's own error toast
  // is in this window, which Electron hides once the call is reported ended,
  // so the failure is carried in the report for the main window to show.
  let rejoiningFor: number | null = null;
  let leftFor: number | null = null;

  const send = (status: CallWindowStatus): void => {
    const serialized = JSON.stringify(status);
    if (serialized === lastSent) return;
    lastSent = serialized;
    report(status);
  };

  roomActor.subscribe(snapshot => {
    const handoffId = activeHandoffId;
    if (handoffId === null) return;
    const phase = phaseOf(snapshot as unknown as SnapshotLike);

    if (phase !== 'idle') {
      if (endedTimer) clearTimeout(endedTimer);
      endedTimer = null;
      endedFor = null;
      if (phase === 'ending') leftFor = handoffId;
      else if (phase === 'connecting' && leftFor === handoffId) rejoiningFor = handoffId;
      else if (phase === 'connected') rejoiningFor = leftFor = null;
      send(buildStatus(handoffId, phase, snapshot.context));
      return;
    }

    if (endedFor === handoffId || endedTimer) return;
    const error =
      snapshot.context.error ?? (rejoiningFor === handoffId ? 'Could not join the call' : null);
    endedTimer = setTimeout(() => {
      endedTimer = null;
      if (activeHandoffId !== handoffId || !roomActor.getSnapshot().matches('idle')) return;
      endedFor = handoffId;
      send({ ...buildStatus(handoffId, 'ended', roomActor.getSnapshot().context), error });
    }, ENDED_SETTLE_MS);
  });
};

const startCommandListener = (api: NonNullable<Window['electronAPI']>['callWindow']): void => {
  api?.onCommand(raw => {
    const command = raw as CallWindowCommand;
    switch (command.type) {
      case 'DISCONNECT':
        roomActor.send({ type: 'DISCONNECT', endForAll: command.endForAll ?? false });
        break;
      case 'LEAVE':
        if (leaveHandler) leaveHandler();
        else roomActor.send({ type: 'DISCONNECT' });
        break;
      case 'TOGGLE_MIC':
      case 'TOGGLE_CAMERA':
      case 'TOGGLE_CALL_CHAT':
        roomActor.send({ type: command.type });
        break;
      default:
        break;
    }
  });
};

/** Idempotent; a no-op outside a desktop build that hosts call windows. */
export const startCallWindowHost = (): void => {
  const api = window.electronAPI?.callWindow;
  if (started || !api) return;
  started = true;
  startStatusReporter();
  startCommandListener(api);
  startHandoffIntake(api);
};
