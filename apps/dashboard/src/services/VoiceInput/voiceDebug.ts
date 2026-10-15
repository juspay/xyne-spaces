import { useSyncExternalStore } from 'react';

/*
 * Local only: it holds what was said, so it is never sent anywhere. On in development builds;
 * elsewhere `?voiceDebug=1` turns it on (remembered) and `?voiceDebug=0` off.
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
  at: number;
  /** Which hold of the orb; 0 before the first. */
  turn: number;
  sinceTurn: number;
  sincePrev: number;
  stage: VoiceDebugStage;
  level: VoiceDebugLevel;
  step: string;
  detail: string;
  data?: unknown;
}

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

/* eslint-disable no-console -- the debugger mirrors its log to the console on purpose */
const CONSOLE: Record<VoiceDebugLevel, (...args: unknown[]) => void> = {
  info: (...args) => console.debug(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};
/* eslint-enable no-console */

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
  (window as unknown as Record<string, unknown>)['__xyneVoiceDebug'] = {
    get events(): VoiceDebugEvent[] {
      return state.events;
    },
    get status(): VoiceDebugStatus {
      return state.status;
    },
    dump: (): string => formatVoiceDebug(state),
  };
}
