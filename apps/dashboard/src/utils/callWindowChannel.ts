const CALL_WINDOW_CHANNEL = 'xyne-call-window-state';

export interface CallWindowState {
  callId: string;
  title: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  screenSharing: boolean;
  connected: boolean;
}

type CallWindowMessage =
  | { kind: 'state'; state: CallWindowState }
  | { kind: 'ended'; callId: string }
  | { kind: 'request-state' }
  | { kind: 'command'; command: 'leave' | 'toggle-mic' | 'toggle-camera' };

const openChannel = (): BroadcastChannel | null => {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(CALL_WINDOW_CHANNEL);
  } catch {
    return null;
  }
};

const post = (message: CallWindowMessage): void => {
  const channel = openChannel();
  if (!channel) return;
  try {
    channel.postMessage(message);
  } finally {
    channel.close();
  }
};

export const publishCallWindowState = (state: CallWindowState): void => {
  post({ kind: 'state', state });
};

export const publishCallWindowEnded = (callId: string): void => {
  post({ kind: 'ended', callId });
};

export const requestCallWindowState = (): void => {
  post({ kind: 'request-state' });
};

export const sendCallWindowCommand = (command: 'leave' | 'toggle-mic' | 'toggle-camera'): void => {
  post({ kind: 'command', command });
};

const LIVE_STALE_CHECK_MS = 5_000;

let liveState: CallWindowState | null = null;
const liveListeners = new Set<() => void>();
let liveChannel: BroadcastChannel | null = null;
let liveStaleTimer: ReturnType<typeof setInterval> | null = null;

const emitLive = (next: CallWindowState | null): void => {
  liveState = next;
  liveListeners.forEach(listener => listener());
};

const ensureLiveSubscription = (): void => {
  if (liveChannel) return;
  liveChannel = openChannel();
  if (!liveChannel) return;
  liveChannel.onmessage = (event: MessageEvent<CallWindowMessage>): void => {
    const message = event.data;
    if (!message) return;
    if (message.kind === 'state') emitLive(message.state);
    else if (message.kind === 'ended') emitLive(null);
  };
  liveStaleTimer ??= setInterval(() => {
    if (liveState && !isCallWindowActive()) emitLive(null);
  }, LIVE_STALE_CHECK_MS);
  requestCallWindowState();
};

export const getLiveCallWindowState = (): CallWindowState | null => liveState;

export const subscribeLiveCallWindow = (listener: () => void): (() => void) => {
  ensureLiveSubscription();
  liveListeners.add(listener);
  return () => {
    liveListeners.delete(listener);
  };
};

interface CallWindowSubscribers {
  onState?: (state: CallWindowState) => void;
  onEnded?: (callId: string) => void;
  onStateRequested?: () => void;
  onCommand?: (command: 'leave' | 'toggle-mic' | 'toggle-camera') => void;
}

export const subscribeCallWindowChannel = (handlers: CallWindowSubscribers): (() => void) => {
  const channel = openChannel();
  if (!channel) return () => undefined;

  channel.onmessage = (event: MessageEvent<CallWindowMessage>): void => {
    const message = event.data;
    if (!message) return;
    switch (message.kind) {
      case 'state':
        handlers.onState?.(message.state);
        break;
      case 'ended':
        handlers.onEnded?.(message.callId);
        break;
      case 'request-state':
        handlers.onStateRequested?.();
        break;
      case 'command':
        handlers.onCommand?.(message.command);
        break;
    }
  };

  return () => channel.close();
};

const CALL_WINDOW_ACTIVE_KEY = 'xyne:call-window-active';
const CALL_WINDOW_ACTIVE_TTL_MS = 30_000;

export const markCallWindowActive = (): void => {
  try {
    localStorage.setItem(CALL_WINDOW_ACTIVE_KEY, String(Date.now()));
  } catch {
    // A blocked localStorage only costs us the drop guard.
  }
};

export const clearCallWindowActive = (): void => {
  try {
    localStorage.removeItem(CALL_WINDOW_ACTIVE_KEY);
  } catch {
    // ignore
  }
};

export const isCallWindowActive = (): boolean => {
  try {
    const raw = localStorage.getItem(CALL_WINDOW_ACTIVE_KEY);
    if (!raw) return false;
    const stamp = Number(raw);
    if (!Number.isFinite(stamp)) return false;
    return Date.now() - stamp < CALL_WINDOW_ACTIVE_TTL_MS;
  } catch {
    return false;
  }
};
