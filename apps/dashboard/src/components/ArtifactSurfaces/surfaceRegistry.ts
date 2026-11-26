import {
  ARTIFACT_DATA_PROTOCOL_VERSION,
  type HostBroadcastMessage,
  type XyneNavigateTarget,
} from '../AIScreen/ReactArtifact/artifactData.constants';

/**
 * Module-level wiring between running apps and the shell.
 *
 * Every sandbox's bridge lives inside a memoized subtree that must not take
 * changing props, and apps run on several surfaces at once (a page, its
 * overlay, a widget). So the pieces that span them — the router, and the
 * running copies of each app — are registered here rather than passed down.
 */

/** What apps may ask for, plus the shell's own way to an app's Agent Hub page. */
export type SurfaceNavigateTarget = XyneNavigateTarget | { kind: 'libraryApp'; appId: string };

type Navigate = (target: SurfaceNavigateTarget) => void;

let navigator: Navigate | null = null;

/** Registered by the shell, which sits inside the router. */
export const setSurfaceNavigator = (next: Navigate | null): void => {
  navigator = next;
};

export const navigateFromApp = (target: SurfaceNavigateTarget): void => {
  navigator?.(target);
};

/** Largest `broadcast` payload relayed, measured as JSON. */
export const MAX_BROADCAST_CHARS = 16_000;

type WindowGetter = () => Window | null;

const runningApps = new Map<string, Set<WindowGetter>>();

/** Adds one running copy of `appId`; returns its removal. */
export const registerRunningApp = (appId: string, getWindow: WindowGetter): (() => void) => {
  let set = runningApps.get(appId);
  if (!set) {
    set = new Set();
    runningApps.set(appId, set);
  }
  set.add(getWindow);
  return () => {
    const entries = runningApps.get(appId);
    if (!entries) return;
    entries.delete(getWindow);
    if (entries.size === 0) runningApps.delete(appId);
  };
};

/**
 * Relays a broadcast to every other running copy of the same app. Copies of
 * other apps never see it.
 */
export const relayBroadcast = (appId: string, from: Window, payload: unknown): void => {
  let size: number;
  try {
    size = JSON.stringify(payload ?? null).length;
  } catch {
    return;
  }
  if (size > MAX_BROADCAST_CHARS) return;
  const message: HostBroadcastMessage = {
    source: 'xyne-artifact-host',
    v: ARTIFACT_DATA_PROTOCOL_VERSION,
    type: 'broadcast',
    payload,
  };
  for (const getWindow of runningApps.get(appId) ?? []) {
    const target = getWindow();
    if (!target || target === from) continue;
    try {
      target.postMessage(message, '*');
    } catch {
      // A copy that is reloading misses this one; broadcasts are best effort.
    }
  }
};
