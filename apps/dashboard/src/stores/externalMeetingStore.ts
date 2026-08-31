import { useSyncExternalStore } from 'react';

/**
 * Whether the user is in a meeting on another platform — Zoom, Teams, Google
 * Meet, a Slack huddle, or a browser tab that has the mic open.
 *
 * The detection itself lives in the Electron main process (mic-monitor +
 * `meeting-detector.ts`) and is macOS-only; this store is just the renderer's
 * copy, fed by `NotificationHandler`. Off Electron it stays null forever, which
 * is correct — there is nothing detecting meetings there.
 *
 * Set at *detection*, independently of whether the user then accepted the
 * "record this meeting?" popup, so it covers both halves of that flow.
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
