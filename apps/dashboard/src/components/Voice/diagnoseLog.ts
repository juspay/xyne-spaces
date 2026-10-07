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
  /** Milliseconds since the last hold started. */
  ms: number;
  step: string;
  detail: string;
}

/** The whole log as text, for pasting into a bug report. */
export const formatDiagnostics = (events: readonly VoiceDiagnostic[]): string =>
  events
    .map(e => `${e.at.toLocaleTimeString()}  +${e.ms}ms  ${e.step}${e.detail && `: ${e.detail}`}`)
    .join('\n');
