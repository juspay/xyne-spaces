import type { EntryPoint } from '../intent/entryPoint';
import type { OpenActionType } from '../machine/openActions';
import type { OpenState } from '../machine/openState';
import type { OpenFailure } from '../types/openFailure';

/** Small production slice — not everyone (Ch. 32). Beta and dev always sample. */
export const OPEN_TRACE_PRODUCTION_SAMPLE_RATE = 0.02;

export type OpenTraceInbound =
  | 'push'
  | 'zero-connect'
  | 'zero-disconnect'
  | 'foreground'
  | 'background'
  | 'keyboard-show'
  | 'keyboard-hide';

export type OpenTraceEvent =
  | {
      kind: 'transition';
      at: number;
      from: OpenState['status'];
      to: OpenState['status'];
      action: OpenActionType;
    }
  | {
      kind: 'warm';
      at: number;
      containsTarget: boolean;
      fingerprint: string;
      ageMs: number;
    }
  | { kind: 'inbound'; at: number; name: OpenTraceInbound }
  | {
      kind: 'outcome';
      at: number;
      status: 'ready' | 'error' | 'idle';
      failure?: OpenFailure;
    };

export type OpenTrace = {
  intentKey: string;
  entry: EntryPoint;
  isColdStart: boolean;
  raw: Readonly<Record<string, unknown>>;
  sampled: boolean;
  events: readonly OpenTraceEvent[];
};

export const shouldSampleOpenTrace = ({
  isDev,
  isBetaUser,
  random = Math.random,
  productionSampleRate = OPEN_TRACE_PRODUCTION_SAMPLE_RATE,
}: {
  isDev: boolean;
  isBetaUser: boolean;
  random?: () => number;
  productionSampleRate?: number;
}): boolean => isDev || isBetaUser || random() < productionSampleRate;

export const createOpenTrace = ({
  intentKey,
  entry,
  isColdStart,
  raw,
  sampled,
}: {
  intentKey: string;
  entry: EntryPoint;
  isColdStart: boolean;
  raw: Readonly<Record<string, unknown>>;
  sampled: boolean;
}): OpenTrace => ({
  intentKey,
  entry,
  isColdStart,
  raw,
  sampled,
  events: [],
});

const append = (trace: OpenTrace, event: OpenTraceEvent): OpenTrace =>
  trace.sampled ? { ...trace, events: [...trace.events, event] } : trace;

export const recordTransition = (
  trace: OpenTrace,
  from: OpenState['status'],
  to: OpenState['status'],
  action: OpenActionType,
  at: number,
): OpenTrace => {
  if (from === to) {
    return trace;
  }
  return append(trace, { kind: 'transition', at, from, to, action });
};

export const recordWarmDecision = (
  trace: OpenTrace,
  input: { containsTarget: boolean; fingerprint: string; ageMs: number; at: number },
): OpenTrace =>
  append(trace, {
    kind: 'warm',
    at: input.at,
    containsTarget: input.containsTarget,
    fingerprint: input.fingerprint,
    ageMs: input.ageMs,
  });

export const recordInbound = (trace: OpenTrace, name: OpenTraceInbound, at: number): OpenTrace =>
  append(trace, { kind: 'inbound', at, name });

export const recordOutcome = (
  trace: OpenTrace,
  status: 'ready' | 'error' | 'idle',
  at: number,
  failure?: OpenFailure,
): OpenTrace =>
  append(
    trace,
    failure ? { kind: 'outcome', at, status, failure } : { kind: 'outcome', at, status },
  );

/** One string that answers "why was this blank?" without a repro. */
export const summarizeOpenTrace = (trace: OpenTrace): string => {
  const warm = [...trace.events].reverse().find(event => event.kind === 'warm');
  const outcome = [...trace.events].reverse().find(event => event.kind === 'outcome');
  const transitions = trace.events
    .filter(event => event.kind === 'transition')
    .map(event =>
      event.kind === 'transition' ? `${event.from}->${event.to}(${event.action})` : '',
    )
    .join(' ');
  const warmBit =
    warm && warm.kind === 'warm'
      ? `warm containsTarget=${warm.containsTarget} ageMs=${warm.ageMs} fingerprint=${warm.fingerprint}`
      : 'warm none';
  const outcomeBit =
    outcome && outcome.kind === 'outcome'
      ? `outcome ${outcome.status}${outcome.failure ? ` ${JSON.stringify(outcome.failure)}` : ''}`
      : 'outcome pending';
  return [
    `intentKey=${trace.intentKey}`,
    `entry=${trace.entry}`,
    `cold=${trace.isColdStart}`,
    `raw=${JSON.stringify(trace.raw)}`,
    warmBit,
    transitions || 'transitions none',
    outcomeBit,
  ].join(' | ');
};
