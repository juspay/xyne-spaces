import { describe, it, expect } from 'vitest';
import { buildStepStates, patchExecutionStep } from './step-state.js';
import { buildIterations } from './iterations.js';
import type { ExecutionDetail } from '@xyne/workflow-sdk/client';

/** Build a step record row. */
function rec(
  stepName: string,
  status: string,
  executorType = 'deterministic',
  data?: Record<string, unknown>,
) {
  return { stepName, status, executorType, data: data ? JSON.stringify(data) : null };
}

function detail(steps: ReturnType<typeof rec>[], config?: unknown): ExecutionDetail {
  return {
    id: 'e1',
    workflowId: 'w1',
    status: 'EXTERNAL_WAIT',
    steps,
    ...(config ? { config } : {}),
  } as unknown as ExecutionDetail;
}

describe('buildStepStates — node-path keying (graph/timeline join)', () => {
  it('keys a nested branch-step record by its BARE leaf id (not the node-path)', () => {
    const m = buildStepStates(
      detail([rec('ocr_all:aoa#0/ocr_aoa', 'COMPLETED', 'deterministic', { output: { ok: true } })]),
    );
    expect(m.get('ocr_aoa')?.status).toBe('completed');
    expect(m.get('ocr_aoa')?.output).toEqual({ ok: true });
    // The graph node id is the bare config id — must NOT be keyed by node-path.
    expect(m.has('ocr_all:aoa#0/ocr_aoa')).toBe(false);
  });

  it('surfaces a deeply-nested paused leaf gate (with pauseState) under its bare id', () => {
    const m = buildStepStates(
      detail([
        rec(
          'verification_gate:if_true#0/ao_bo_parallel:bo#0/bo_collect',
          'EXTERNAL_WAIT',
          'deterministic',
          { pauseState: { reason: 'approve BO' } },
        ),
      ]),
    );
    expect(m.get('bo_collect')?.status).toBe('paused');
    expect(m.get('bo_collect')?.pauseState).toEqual({ reason: 'approve BO' });
  });

  it('maps REVIEW_WAIT to paused', () => {
    const m = buildStepStates(detail([rec('draft', 'REVIEW_WAIT', 'deterministic', { output: {} })]));
    expect(m.get('draft')?.status).toBe('paused');
  });

  it('aggregates multiple records for one bare id by precedence (paused outranks completed)', () => {
    const m = buildStepStates(
      detail([
        rec('loop_y:body#0/summarize', 'COMPLETED', 'deterministic', { output: { i: 0 } }),
        rec('loop_y:body#1/summarize', 'EXTERNAL_WAIT', 'deterministic', { pauseState: { reason: 'wait' } }),
      ]),
    );
    // One config node, two iteration records → the attention-worthy status wins.
    expect(m.get('summarize')?.status).toBe('paused');
    expect(m.get('summarize')?.pauseState).toEqual({ reason: 'wait' });
  });

  it('keeps a control-step marker status under its own bare id', () => {
    const m = buildStepStates(
      detail([rec('ocr_all', 'COMPLETED', 'conditional', { output: { mode: 'allSettled' } })]),
    );
    expect(m.get('ocr_all')?.status).toBe('completed');
  });

  it('falls back to the legacy step_N → config id mapping', () => {
    const m = buildStepStates(
      detail([rec('step_0', 'COMPLETED', 'deterministic', { output: {} })], {
        steps: [{ id: 'first', type: 'ECHO', config: {} }],
      }),
    );
    expect(m.get('first')?.status).toBe('completed');
  });
});

describe('patchExecutionStep — incremental SSE updates by node-path', () => {
  it('updates the exact node-path record, merging data (status + output)', () => {
    const d = detail([
      rec('map1:item#0/validate', 'RUNNING', 'deterministic'),
      rec('map1:item#1/validate', 'RUNNING', 'deterministic'),
    ]);
    const next = patchExecutionStep(d, 'map1:item#0/validate', {
      status: 'COMPLETED',
      dataMerge: { output: { ok: true } },
    })!;

    // only iteration 0's record changed — iteration 1 untouched (per-iteration!)
    const recs = next.steps;
    const r0 = recs.find((s) => s.stepName === 'map1:item#0/validate')!;
    const r1 = recs.find((s) => s.stepName === 'map1:item#1/validate')!;
    expect(r0.status).toBe('COMPLETED');
    expect(JSON.parse(r0.data!).output).toEqual({ ok: true });
    expect(r1.status).toBe('RUNNING'); // unchanged
    // immutable — original detail not mutated
    expect(d.steps.find((s) => s.stepName === 'map1:item#0/validate')!.status).toBe('RUNNING');
  });

  it('appends a fresh record on a step’s first event (upsert)', () => {
    const next = patchExecutionStep(detail([]), 'map1:item#2/validate', {
      status: 'EXTERNAL_WAIT',
      dataMerge: { pauseState: { reason: 'approve' } },
    })!;
    expect(next.steps).toHaveLength(1);
    expect(next.steps[0]!.stepName).toBe('map1:item#2/validate');
    expect(next.steps[0]!.status).toBe('EXTERNAL_WAIT');
  });

  it('is a no-op before the first snapshot (no execution yet)', () => {
    expect(patchExecutionStep(undefined, 'x', { status: 'RUNNING' })).toBeUndefined();
  });

  it('drives MAP lanes: a pause event flows through to the lane that derives from steps', () => {
    let d: ExecutionDetail | undefined = detail([
      rec('m:item#0/gate', 'RUNNING', 'deterministic'),
      rec('m:item#1/gate', 'RUNNING', 'deterministic'),
    ]);
    // iteration 1 pauses (SSE execution_paused for its node-path)
    d = patchExecutionStep(d, 'm:item#1/gate', {
      status: 'EXTERNAL_WAIT',
      dataMerge: { pauseState: { reason: 'approve PAN' } },
    });
    const lanes = buildIterations('m', d!.steps);
    expect(lanes[0]!.states.get('gate')?.status).toBe('running');
    expect(lanes[1]!.states.get('gate')?.status).toBe('paused'); // updated live, no refetch
    expect(lanes[1]!.states.get('gate')?.nodePath).toBe('m:item#1/gate');
  });
});
