import { useSyncExternalStore } from 'react';
import type { CallType, SdlcCallLink } from '@xyne/shared';
import type { CallUrlOverrides } from './callUrlOverrides';
import type { JoinMediaOverrides } from '../machines/roomMachine';
import { isElectronApp, isStandaloneWindow } from './electronApp';
import { isNativeCallSupported } from './reactNativeBridge';
import { authActor } from '../machines/authMachine';

/**
 * Calls in their own desktop window (as in Slack huddles).
 *
 * The main window keeps deciding whether there is a call: it fetches the
 * LiveKit token, handles the lobby and rings, exactly as for the in-app
 * overlay. Once it has a token it hands the call to a separate Electron window
 * (page `/newWindow/call.html`), which owns the LiveKit connection and renders the
 * call UI. The call window reports back with {@link CallWindowStatus}, and the
 * main window's roomActor mirrors that in `connected.windowMode`, the way it
 * mirrors the React Native host in `nativeMode`.
 */

// Its own page (newWindow/call.html, entry src/callWindow/main.tsx), not a
// route of the app, so the window loads only the call. Under /newWindow/ so it
// counts as a standalone window (isStandaloneWindow).
export const CALL_WINDOW_ROUTE = '/newWindow/call.html';
// Off by default: calls open in the in-app overlay unless the user opts in.
export const CALL_WINDOW_ENABLED_KEY = 'xyne:call-window-enabled';

export interface CallWindowParticipant {
  identity: string;
  name?: string;
  isCameraEnabled: boolean;
  isMicrophoneEnabled: boolean;
  isScreenShareEnabled: boolean;
  isLocal: boolean;
}

/** Everything the call window needs to connect. Must survive structured clone. */
export interface CallWindowHandoff {
  token: string;
  serverUrl: string;
  callType: CallType;
  externalId: string;
  callId: string | null;
  channelId: string | null;
  roomLink: string | null;
  scopeType: string | null;
  conversationId: string | null;
  artifactMessageId: string | null;
  sdlcLink: SdlcCallLink | null;
  targetUserIds: string[];
  callDisplayName: string | null;
  isInitiator: boolean;
  callUrlOverrides: CallUrlOverrides | null;
  // The main window's CAC check on callUrlOverrides (see isCallUrlApiAllowed).
  callUrlOverridesApproved: boolean;
  joinMediaOverrides: JoinMediaOverrides | null;
  callHostUserIdHint: string | null;
}

export type CallWindowPhase = 'connecting' | 'connected' | 'ending' | 'ended';

export interface CallWindowStatus {
  handoffId: number;
  phase: CallWindowPhase;
  externalId: string | null;
  callId: string | null;
  channelId: string | null;
  callType: CallType | null;
  roomLink: string | null;
  scopeType: string | null;
  conversationId: string | null;
  callStartTime: number | null;
  connectionState: string | null;
  participants: CallWindowParticipant[];
  error: string | null;
  // With phase 'ending': the user left (not a switch to another call).
  userLeft?: boolean;
}

export type CallWindowCommand =
  | { type: 'DISCONNECT'; endForAll?: boolean }
  // From Electron only (the window was closed): leave as the Leave button does.
  | { type: 'LEAVE' }
  | { type: 'TOGGLE_MIC' }
  | { type: 'TOGGLE_CAMERA' }
  | { type: 'TOGGLE_CALL_CHAT' };

// ─── Preference (per device) ────────────────────────────────────────────────

const listeners = new Set<() => void>();

const readEnabled = (): boolean => {
  try {
    return localStorage.getItem(CALL_WINDOW_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key === CALL_WINDOW_ENABLED_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

export const setCallWindowEnabled = (enabled: boolean): void => {
  try {
    localStorage.setItem(CALL_WINDOW_ENABLED_KEY, String(enabled));
  } catch {
    // Storage unavailable: the default (off) stays in effect.
  }
  listeners.forEach(listener => listener());
};

/**
 * Whether this desktop build can host a call window. A dashboard newer than the
 * installed desktop app lacks the bridge, and then calls stay in the overlay.
 */
export const isCallWindowSupported = (): boolean =>
  isElectronApp() && typeof window !== 'undefined' && !!window.electronAPI?.callWindow;

export const useCallWindowSettings = (): {
  enabled: boolean;
  isSupported: boolean;
  setEnabled: (enabled: boolean) => void;
} => {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
  return { enabled, isSupported: isCallWindowSupported(), setEnabled: setCallWindowEnabled };
};

/** This renderer is the call window itself. */
export const isCallWindowRoute = (): boolean =>
  typeof window !== 'undefined' && window.location.pathname === CALL_WINDOW_ROUTE;

/**
 * Whether a call started now, from this window, should go to the call window.
 * Only the main window hands calls off: detached windows (SDLC and the like)
 * run their own overlay, and the call window hosts the call itself.
 */
export const shouldUseCallWindow = (): boolean =>
  isCallWindowSupported() && readEnabled() && !isStandaloneWindow() && !isNativeCallSupported();

// ─── Main-window side ───────────────────────────────────────────────────────

const WORKSPACE_ID_PATTERN = /^[a-z0-9-]{20,}$/i;

const workspaceIdOfPath = (path: string): string | null => {
  const segment = path.match(/^\/([^/?#]+)/)?.[1];
  return segment && WORKSPACE_ID_PATTERN.test(segment) ? segment : null;
};

/**
 * Who the call window is opened for. A kept window is reused only by the same
 * user in the same workspace: it holds that session's auth and Zero data.
 *
 * The workspace comes from the session rather than the URL, which does not
 * carry one yet on some routes (e.g. /call/:id while a call link is joining).
 */
const callWindowOwner = (): { workspaceId: string | null; userId: string | null } => {
  const user = authActor.getSnapshot().context.user;
  return {
    workspaceId: user?.workspaceId ?? workspaceIdOfPath(window.location.pathname),
    userId: user?.id ?? null,
  };
};

// The most recent status, so a wait that starts after a report (it raced the
// open() round trip) still sees it. Cleared when a new join starts, so it only
// ever holds a status of the current call.
let latestStatus: CallWindowStatus | null = null;
let statusCacheInstalled = false;
// The current join has been handed to the call window. Until then there is no
// call there to wait on when it is left.
let isHandedOff = false;

const installStatusCache = (): void => {
  const api = window.electronAPI?.callWindow;
  if (statusCacheInstalled || !api) return;
  statusCacheInstalled = true;
  api.onStatus(status => {
    latestStatus = status as CallWindowStatus;
  });
};

export const openCallWindow = async (handoff: CallWindowHandoff): Promise<number> => {
  const api = window.electronAPI?.callWindow;
  if (!api) throw new Error('Call window is not available');
  installStatusCache();
  latestStatus = null;
  isHandedOff = true;
  return api.open({
    handoff: handoff as unknown as Record<string, unknown>,
    ...callWindowOwner(),
  });
};

/**
 * Open the call window now, ahead of the token: the app inside it boots while
 * the main window is still joining. Optional on the bridge — a desktop build
 * without it opens the window at handoff, as before.
 */
export const prepareCallWindow = (): void => {
  latestStatus = null;
  isHandedOff = false;
  window.electronAPI?.callWindow?.prepare?.(callWindowOwner());
};

/** The join the window was opened for did not happen. */
export const cancelPreparedCallWindow = (): void => {
  window.electronAPI?.callWindow?.cancelPrepare?.();
};

export const getCallWindowStatus = async (): Promise<CallWindowStatus | null> => {
  const api = window.electronAPI?.callWindow;
  if (!api) return null;
  // A report landing right after this read is still seen by a wait that follows.
  installStatusCache();
  try {
    return ((await api.getStatus()) as CallWindowStatus | null) ?? null;
  } catch {
    return null;
  }
};

export const onCallWindowStatus = (callback: (status: CallWindowStatus) => void): (() => void) => {
  const api = window.electronAPI?.callWindow;
  if (!api) return () => undefined;
  return api.onStatus(status => callback(status as CallWindowStatus));
};

export const sendCallWindowCommand = (command: CallWindowCommand): void => {
  window.electronAPI?.callWindow?.sendCommand(command);
};

export const focusCallWindow = (): void => {
  window.electronAPI?.callWindow?.focus();
};

/**
 * From the call window: open an app path in the main window. A path in another
 * workspace carries that workspace along, so main switches to it first.
 */
export const openInMainWindow = (appPath: string): void => {
  window.electronAPI?.callWindow?.openInMain(appPath, workspaceIdOfPath(appPath) ?? undefined);
};

/** The call window closed before connecting, with no error: the user backed out. */
export class CallWindowClosedError extends Error {
  constructor() {
    super('The call window was closed');
    this.name = 'CallWindowClosedError';
  }
}

/**
 * Resolves once the call window reports `phase` for `handoffId` (any handoff
 * when null). Waiting for 'connected' rejects if the call ends first or nothing
 * arrives in time; waiting for 'ended' resolves null on timeout.
 */
export const waitForCallWindowPhase = (
  handoffId: number | null,
  phase: 'connected' | 'ended',
  timeoutMs: number,
): Promise<CallWindowStatus | null> =>
  new Promise((resolve, reject) => {
    // Left before anything was handed over: Electron just closes the window it
    // opened early, and nothing reports on it.
    if (phase === 'ended' && handoffId === null && !isHandedOff) {
      resolve(null);
      return;
    }
    const cached = latestStatus;
    if (cached && (handoffId === null || cached.handoffId === handoffId)) {
      if (cached.phase === 'ended') {
        if (phase === 'ended') resolve(cached);
        else reject(cached.error ? new Error(cached.error) : new CallWindowClosedError());
        return;
      }
      if (phase === 'connected' && cached.phase === 'connected') {
        resolve(cached);
        return;
      }
    }

    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      if (phase === 'ended') resolve(null);
      else reject(new Error('The call window did not connect in time'));
    }, timeoutMs);

    unsubscribe = onCallWindowStatus(status => {
      if (handoffId !== null && status.handoffId !== handoffId) return;
      if (status.phase === 'ended') {
        clearTimeout(timer);
        unsubscribe();
        if (phase === 'ended') resolve(status);
        else reject(status.error ? new Error(status.error) : new CallWindowClosedError());
        return;
      }
      if (phase === 'connected' && status.phase === 'connected') {
        clearTimeout(timer);
        unsubscribe();
        resolve(status);
      }
    });
  });
