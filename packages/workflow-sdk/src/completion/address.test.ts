import { describe, it, expect } from 'vitest';
import { collectStepIds, resolveGate } from './address.js';
import type { Resolution } from './address.js';
import type { DeliveryOutcome } from './types.js';
import type { StepRecord } from '../persistence/types.js';

const row = (stepName: string, status: string): StepRecord => ({
  stepName,
  status,
  executorType: 'deterministic',
  data: '{}',
});

const KNOWN = new Set(['start_build', 'wait_for_build', 'later']);

/** The outcome branch of a resolution, failing loudly if it resolved to a gate. */
function outcomeOf(resolution: Resolution): DeliveryOutcome {
  if (resolution.kind !== 'outcome') {
    throw new Error(`expected an outcome, got a gate at ${resolution.row.stepName}`);
  }
  return resolution.outcome;
}

describe('resolveGate', () => {
  const at = (stepId: string) => ({ executionId: 'e1', stepId });

  it('finds the one parked node a step id names', () => {
    const resolved = resolveGate(at('wait_for_build'), 'EXTERNAL_WAIT', [row('wait_for_build', 'EXTERNAL_WAIT')], KNOWN);
    expect(resolved).toEqual({ kind: 'gate', row: row('wait_for_build', 'EXTERNAL_WAIT') });
  });

  it('tells a run that has not reached the step from one with no such step', () => {
    // The sender should retry the first and give up on the second, which is the
    // whole reason the config is consulted.
    expect(outcomeOf(resolveGate(at('later'), 'EXTERNAL_WAIT', [], KNOWN))).toEqual({ kind: 'not_ready' });
    expect(outcomeOf(resolveGate(at('typo'), 'EXTERNAL_WAIT', [], KNOWN))).toEqual({ kind: 'unknown' });
  });

  it('says a step that already ran has answered', () => {
    const rows = [row('wait_for_build', 'COMPLETED')];
    expect(outcomeOf(resolveGate(at('wait_for_build'), 'EXTERNAL_WAIT', rows, KNOWN))).toEqual({
      kind: 'ignored',
      reason: 'already_answered',
    });
  });

  it('refuses to guess between two parked instances of one step', () => {
    const rows = [
      row('map1:body#0/wait_for_build', 'EXTERNAL_WAIT'),
      row('map1:body#1/wait_for_build', 'EXTERNAL_WAIT'),
    ];
    expect(outcomeOf(resolveGate(at('wait_for_build'), 'EXTERNAL_WAIT', rows, KNOWN))).toEqual({
      kind: 'ambiguous',
      nodePaths: ['map1:body#0/wait_for_build', 'map1:body#1/wait_for_build'],
    });
  });

  it('takes an exact node path when the caller has one', () => {
    const rows = [
      row('map1:body#0/wait_for_build', 'EXTERNAL_WAIT'),
      row('map1:body#1/wait_for_build', 'EXTERNAL_WAIT'),
    ];
    const resolved = resolveGate(
      { executionId: 'e1', stepId: 'wait_for_build', nodePath: 'map1:body#1/wait_for_build' },
      'EXTERNAL_WAIT',
      rows,
      KNOWN,
    );
    expect(resolved.kind === 'gate' && resolved.row.stepName).toBe('map1:body#1/wait_for_build');
  });

  it('drops anything addressed at a run that is over', () => {
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED']) {
      expect(outcomeOf(resolveGate(at('wait_for_build'), status, [row('wait_for_build', 'EXTERNAL_WAIT')], KNOWN))).toEqual({
        kind: 'ignored',
        reason: 'run_ended',
      });
    }
  });

  it('counts a review gate as open', () => {
    const resolved = resolveGate(at('wait_for_build'), 'EXTERNAL_WAIT', [row('wait_for_build', 'REVIEW_WAIT')], KNOWN);
    expect(resolved.kind).toBe('gate');
  });
});

describe('collectStepIds', () => {
  it('finds step ids at any depth, whatever the branch is called', () => {
    const ids = collectStepIds({
      steps: [
        { id: 'a', type: 'ECHO' },
        {
          id: 'cond',
          type: 'CONDITIONAL',
          config: {
            if_true: [{ id: 'b', type: 'ECHO' }],
            if_false: [{ id: 'par', type: 'PARALLEL', config: { branches: { x: [{ id: 'c', type: 'WAIT' }] } } }],
          },
        },
      ],
    });
    expect([...ids].sort()).toEqual(['a', 'b', 'c', 'cond', 'par']);
  });

  it('survives a config that is not a step tree at all', () => {
    expect([...collectStepIds(null)]).toEqual([]);
    expect([...collectStepIds({ trigger: { type: 'MANUAL', config: {} } })]).toEqual([]);
  });
});
