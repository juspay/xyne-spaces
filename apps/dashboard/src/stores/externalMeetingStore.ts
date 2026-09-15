import { useSyncExternalStore } from 'react';

/**
 * What the user is doing outside Xyne, as seen by the Electron main process
 * (mic-monitor + `meeting-detector.ts`, macOS only). This store is just the
 * renderer's copy, fed by `NotificationHandler`; off Electron both halves stay
 * empty forever, which is correct — nothing is watching there.
 *
 * Two separate signals, and the distinction matters:
 *
 * - `micBusy` — something holds the mic. This is what silences an incoming
 *   call, precisely because it asks nothing else: not which app, and not
 *   whether the user left meeting detection on.
 * - `meeting` — which app, once identified. Attribution for telemetry only, so
 *   a silenced ring with no meeting app is visible as a possible false
 *   positive. Set at *detection*, whether or not the user then accepted the
 *   "record this meeting?" popup.
 */
export interface ExternalMeeting {
  /** `zoom` | `microsoft-teams` | `slack-huddle` | `google-meet` | `browser-meeting`. */
  app: string;
  startedAt: string;
}

let meeting: ExternalMeeting | null = null;
const listeners = new Set<() => void>();

export function setExternalMeeting(next: ExternalMeeting | null): void {
  if (meeting === next) return;
  meeting = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getExternalMeeting(): ExternalMeeting | null {
  return meeting;
}

export function subscribeExternalMeeting(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

export function useExternalMeeting(): ExternalMeeting | null {
  return useSyncExternalStore(subscribeExternalMeeting, getExternalMeeting);
}

// ── Mic activity ───────────────────────────────────────────────────

let micBusy = false;
const micListeners = new Set<() => void>();

export function setMicBusy(next: boolean): void {
  if (micBusy === next) return;
  micBusy = next;
  for (const listener of micListeners) {
    listener();
  }
}

export function getMicBusy(): boolean {
  return micBusy;
}

export function subscribeMicBusy(listener: () => void): () => void {
  micListeners.add(listener);
  return (): void => {
    micListeners.delete(listener);
  };
}

export function useMicBusy(): boolean {
  return useSyncExternalStore(subscribeMicBusy, getMicBusy);
}
