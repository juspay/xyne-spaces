import { useSyncExternalStore } from 'react';
import type { RouteTiming } from '../../services/assistantRouteService';
import { createStore } from '../../utils/createStore';
import type { Decision } from '../Assistant/engine/interpret';
import type { Route } from '../Assistant/router';

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
const { subscribe, notify } = createStore();

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
  notify();
}

export const useDiagnostics = (): VoiceDiagnostic[] =>
  useSyncExternalStore(subscribe, () => events);

/** What Jev chose for a sentence, and the values it read. */
export const describeRoute = (route: Route): string => {
  const chosen =
    'actions' in route
      ? ` ${route.actions.map(a => a.id).join(', ')}`
      : 'action' in route
        ? ` ${route.action.id}`
        : '';
  const fields = 'fields' in route ? ` ${JSON.stringify(route.fields)}` : '';
  return `${route.kind}${chosen}${fields}`;
};

/** A sentence settled without Jev: the event, and the fields it fills. */
export const describeLocal = (decision: Decision): string => {
  if (decision.kind !== 'event') return decision.kind;
  const { event } = decision;
  return event.type === 'fields' ? `fields ${JSON.stringify(event.values)}` : event.type;
};

/** How long routing took, with the server's share when it said. */
export const describeTiming = (timing: RouteTiming | undefined): string =>
  timing
    ? ` · ${timing.ms} ms${timing.serverMs === undefined ? '' : ` (server ${timing.serverMs} ms)`}`
    : '';

// Typed requests have no Diagnose panel: in DevTools, copy(xyneDiagnose()) copies the log.
if (DIAGNOSE_ENABLED) Object.assign(window, { xyneDiagnose: () => formatDiagnostics(events) });
