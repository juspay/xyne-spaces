import { describe, it, expect } from 'vitest';
import { buildIterations, iterationItemValues } from './iterations.js';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';

/** Build a step record row (mirrors use-execution-viewer.test). */
function rec(stepName: string, status: string, data?: Record<string, unknown>) {
  return { stepName, status, executorType: 'deterministic', data: data ? JSON.stringify(data) : null };
}

const records = (rows: ReturnType<typeof rec>[]) => rows as unknown as ExecutionDetail['steps'];

describe('buildIterations / iterationItemValues', () => {
  it('returns no lanes when there are no records', () => {
    expect(buildIterations('owners_map', undefined)).toEqual([]);
    expect(buildIterations('owners_map', records([]))).toEqual([]);
  });

  it('groups iteration records into one lane per index, sorted, frame-stripped', () => {
    const lanes = buildIterations(
      'owners_map',
      records([
        rec('extract', 'COMPLETED', { output: { owners: ['a', 'b'] } }), // top-level, ignored
        rec('owners_map:item#1/validate', 'COMPLETED', { output: { ok: true } }),
        rec('owners_map:item#0/validate', 'COMPLETED', { output: { ok: false } }),
      ]),
    );

    expect(lanes.map((l) => l.index)).toEqual([0, 1]); // sorted by index
    // states keyed by bare leaf id (frame stripped), per-iteration
    expect(lanes[0]!.states.get('validate')?.output).toEqual({ ok: false });
    expect(lanes[1]!.states.get('validate')?.output).toEqual({ ok: true });
    // lane records are relative to the iteration (frame stripped) — feeds a nested MAP
    expect(lanes[0]!.records!.map((r) => r.stepName)).toEqual(['validate']);
    // each lane carries its node-path frame for per-iteration selection ids
    expect(lanes[0]!.prefix).toBe('owners_map:item#0/');
    expect(lanes[1]!.prefix).toBe('owners_map:item#1/');
  });

  it('keeps a paused iteration gate resumable (retains node-path + paused status)', () => {
    const lanes = buildIterations(
      'm',
      records([
        rec('m:item#0/gate', 'COMPLETED', { output: {} }),
        rec('m:item#1/gate', 'EXTERNAL_WAIT', { pauseState: { reason: 'approve' } }),
      ]),
    );

    expect(lanes[1]!.states.get('gate')?.status).toBe('paused');
    // nodePath is the FULL record key so the gate selector / sidebar can resume it
    expect(lanes[1]!.states.get('gate')?.nodePath).toBe('m:item#1/gate');
  });

  it('matches the iteration index, not a numeric suffix in the step id', () => {
    const lanes = buildIterations(
      'm',
      records([rec('m:item#0/step5', 'COMPLETED', { output: {} })]),
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0]!.index).toBe(0);
    expect(lanes[0]!.states.has('step5')).toBe(true);
  });

  it('reads iteration item values from MAP (items) and LOOP (results) outputs', () => {
    const mapVals = iterationItemValues(
      records([rec('m', 'RUNNING', { output: { items: [{ index: 0, item: 'alice' }, { index: 1, item: 'bob' }] } })]),
      'm',
    );
    expect(mapVals).toEqual({ 0: 'alice', 1: 'bob' });

    const loopVals = iterationItemValues(
      records([rec('l', 'COMPLETED', { output: { results: ['x', 'y'], count: 2 } })]),
      'l',
    );
    expect(loopVals).toEqual({ 0: 'x', 1: 'y' });

    expect(iterationItemValues(records([]), 'missing')).toEqual({});
  });
});
