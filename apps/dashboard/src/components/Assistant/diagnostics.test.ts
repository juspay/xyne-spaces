import { describe, expect, it } from 'vitest';
import {
  appendTrace,
  describeInput,
  describeReply,
  describeTimings,
  type TraceEntry,
} from './diagnostics';

describe('the Diagnose log', () => {
  it('describes what was sent and what came back in one line each', () => {
    expect(describeInput({ kind: 'text', text: 'DM Daniel hello', via: 'voice' })).toBe(
      'voice “DM Daniel hello”',
    );
    expect(
      describeReply({
        turnId: 't1',
        say: '',
        run: {
          runId: 'r1',
          plan: [
            { op: 'open_or_create_dm', user: { kind: 'person', id: 'u1', name: 'Daniel' } },
            { op: 'navigate', target: { fromStep: 0 } },
          ],
        },
        expectsReply: false,
      }),
    ).toBe('plan: open_or_create_dm → navigate');
  });

  it('keeps only the latest events', () => {
    let trace: TraceEntry[] = [];
    for (let index = 0; index < 205; index += 1) trace = appendTrace(trace, 'Step', `${index}`);
    expect(trace).toHaveLength(200);
    expect(trace.at(-1)?.detail).toBe('204');
  });

  it('describes only backend and Jev timing', () => {
    expect(describeTimings({ backendMs: 538.46, jevMs: [231.24, 89] })).toBe(
      'backend 538.5 ms · Jev 231.2 ms, 89.0 ms',
    );
  });
});
