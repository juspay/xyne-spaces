import { useSyncExternalStore } from 'react';

/*
 * The voice debugger: every stage of a spoken turn writes here, from the press of the orb to the
 * reply being spoken. Local only: it holds what was said, so it is never sent anywhere.
 *
 * On in development builds. Elsewhere, open any page with `?voiceDebug=1` (remembered in this
 * browser), or set localStorage['xyne:voice-debug'] = '1'; `?voiceDebug=0` turns it off again.
 * While on, it is mirrored to the console as `[voice:<stage>]` and kept on `window.__xyneVoiceDebug`.
 */

const STORAGE_KEY = 'xyne:voice-debug';
const MAX_EVENTS = 400;

function readOptIn(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('voiceDebug');
    if (param === '1') localStorage.setItem(STORAGE_KEY, '1');
    if (param === '0') localStorage.removeItem(STORAGE_KEY);
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export const VOICE_DEBUG_ENABLED = import.meta.env.DEV || readOptIn();

/** Where in the turn an event happened, in the order a turn goes through them. */
export type VoiceDebugStage =
  | 'input'
  | 'mic'
  | 'socket'
  | 'stt'
  | 'route'
  | 'ask'
  | 'tts'
  | 'session';

export type VoiceDebugLevel = 'info' | 'warn' | 'error';

export interface VoiceDebugEvent {
  id: number;
  /** Epoch milliseconds. */
  at: number;
  /** Which hold of the orb this belongs to; 0 before the first one. */
  turn: number;
  /** Milliseconds since the turn started, and since the event before it. */
  sinceTurn: number;
  sincePrev: number;
  stage: VoiceDebugStage;
  level: VoiceDebugLevel;
  step: string;
  detail: string;
  /** Anything structured worth inspecting alongside the step. */
  data?: unknown;
}

/** What the pipeline looks like right now, for the status strip. */
export interface VoiceDebugStatus {
  permission: string;
  audioContext: string;
  mic: 'off' | 'starting' | 'live' | 'error';
  micLabel: string;
  socket: 'closed' | 'connecting' | 'open' | 'error';
  framesSent: number;
  bytesSent: number;
  lastServerMessage: string;
}

export interface VoiceDebugState {
  events: VoiceDebugEvent[];
  status: VoiceDebugStatus;
}

const INITIAL_STATUS: VoiceDebugStatus = {
  permission: 'unknown',
  audioContext: 'none',
  mic: 'off',
  micLabel: '',
  socket: 'closed',
  framesSent: 0,
  bytesSent: 0,
  lastServerMessage: '',
};

let state: VoiceDebugState = { events: [], status: INITIAL_STATUS };
let nextId = 0;
let turn = 0;
let turnStart = performance.now();
let lastAt = turnStart;
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach(listener => listener());

const CONSOLE: Record<VoiceDebugLevel, (...args: unknown[]) => void> = {
  // eslint-disable-next-line no-console
  info: (...args) => console.debug(...args),
  // eslint-disable-next-line no-console
  warn: (...args) => console.warn(...args),
  // eslint-disable-next-line no-console
  error: (...args) => console.error(...args),
};

function log(
  stage: VoiceDebugStage,
  step: string,
  detail = '',
  options: { level?: VoiceDebugLevel; data?: unknown } = {},
): void {
  if (!VOICE_DEBUG_ENABLED) return;
  const now = performance.now();
  const level = options.level ?? 'info';
  const event: VoiceDebugEvent = {
    id: nextId++,
    at: Date.now(),
    turn,
    sinceTurn: Math.round(now - turnStart),
    sincePrev: Math.round(now - lastAt),
    stage,
    level,
    step,
    detail,
    ...(options.data !== undefined && { data: options.data }),
  };
  lastAt = now;
  state = { ...state, events: [...state.events, event].slice(-MAX_EVENTS) };
  CONSOLE[level](`[voice:${stage}] ${step}${detail && `: ${detail}`}`, options.data ?? '');
  emit();
}

/** Starts a new turn: the following events are timed from now. */
function startTurn(): void {
  if (!VOICE_DEBUG_ENABLED) return;
  turn++;
  turnStart = performance.now();
  lastAt = turnStart;
}

function setStatus(patch: Partial<VoiceDebugStatus>): void {
  if (!VOICE_DEBUG_ENABLED) return;
  state = { ...state, status: { ...state.status, ...patch } };
  emit();
}

function clear(): void {
  state = { events: [], status: state.status };
  emit();
}

export const voiceDebug = { log, startTurn, setStatus, clear };

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
};

export const useVoiceDebug = (): VoiceDebugState => useSyncExternalStore(subscribe, () => state);

const clock = (at: number): string => {
  const time = new Date(at);
  return `${time.toLocaleTimeString([], { hour12: false })}.${String(time.getMilliseconds()).padStart(3, '0')}`;
};

/** The log as text, for pasting into a bug report. */
export function formatVoiceDebug({ events, status }: VoiceDebugState): string {
  const head = Object.entries(status)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('  ');
  const lines = events.map(event => {
    const data = event.data === undefined ? '' : `  ${JSON.stringify(event.data)}`;
    return (
      `${clock(event.at)}  #${event.turn} +${event.sinceTurn}ms (Δ${event.sincePrev})  ` +
      `${event.level.toUpperCase()} [${event.stage}] ${event.step}${event.detail && `: ${event.detail}`}${data}`
    );
  });
  return [`status: ${head}`, ...lines].join('\n');
}

if (VOICE_DEBUG_ENABLED && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__xyneVoiceDebug = {
    get events(): VoiceDebugEvent[] {
      return state.events;
    },
    get status(): VoiceDebugStatus {
      return state.status;
    },
    dump: (): string => formatVoiceDebug(state),
  };
}
