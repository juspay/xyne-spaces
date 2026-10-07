import { useSyncExternalStore } from 'react';

// The Diagnose log is local only: it holds what was said, so it is never sent anywhere.
// Always on in development builds; staging can opt in with localStorage['xyne:voice-debug'] = '1'.
const optedIn = (): boolean => {
  try {
    return localStorage.getItem('xyne:voice-debug') === '1';
  } catch {
    return false;
  }
};

export const DIAGNOSE_ENABLED = import.meta.env.DEV || optedIn();

export interface VoiceDiagnostic {
  id: number;
  at: Date;
  /** Milliseconds since the request started (a hold of the orb, or a typed message). */
  ms: number;
  step: string;
  detail: string;
}

/** The whole log as text, for pasting into a bug report. */
export const formatDiagnostics = (events: readonly VoiceDiagnostic[]): string =>
  events
    .map(e => `${e.at.toLocaleTimeString()}  +${e.ms}ms  ${e.step}${e.detail && `: ${e.detail}`}`)
    .join('\n');

// One log for voice and Xyne Buddy. It outlives voice mode, so a failure is still there to copy.
const MAX_EVENTS = 200;
let events: VoiceDiagnostic[] = [];
let sequence = 0;
let startedAt: number | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

/** The next event starts a new request: timings count from it. */
export function startRequest(): void {
  startedAt = null;
}

export function diagnose(step: string, detail = ''): void {
  if (!DIAGNOSE_ENABLED) return;
  const now = performance.now();
  startedAt ??= now;
  const event = { id: sequence++, at: new Date(), ms: Math.round(now - startedAt), step, detail };
  events = [...events, event].slice(-MAX_EVENTS);
  listeners.forEach(listener => listener());
}

export const useDiagnostics = (): VoiceDiagnostic[] =>
  useSyncExternalStore(subscribe, () => events);

// Typed requests have no Diagnose panel: in DevTools, copy(xyneDiagnose()) copies the log.
if (DIAGNOSE_ENABLED) Object.assign(window, { xyneDiagnose: () => formatDiagnostics(events) });
