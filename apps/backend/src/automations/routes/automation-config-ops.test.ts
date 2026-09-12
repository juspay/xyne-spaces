/**
 * Unit tests for the pure step-tree operations. No database, no express — these
 * run without touching any real data.
 */
import { ControlFlowStepType } from '../types/known-types';
import type { AutomationConfig, AutomationStepConfig } from '../types/automation-config';
import { applyConfigOperations, ConfigOpError } from './automation-config-ops';

const action = (id: string): AutomationStepConfig =>
  ({ id, type: 'SEND_MESSAGE', config: { text: id } }) as AutomationStepConfig;

function baseConfig(): AutomationConfig {
  return {
    trigger: { type: 'MESSAGE_RECEIVED', config: { channelIds: ['chan-1'] } },
    steps: [
      action('a'),
      {
        id: 'cond',
        type: ControlFlowStepType.CONDITIONAL,
        config: {
          condition: { variable: '{{context.x}}', operator: 'eq', value: 1 },
          if_true: [action('t1')],
          if_false: [action('f1')],
        },
      },
      {
        id: 'sw',
        type: ControlFlowStepType.SWITCH,
        config: {
          cases: [
            {
              condition: { variable: '{{context.y}}', operator: 'eq', value: 2 },
              steps: [action('c1')],
            },
          ],
          default: [action('d1')],
        },
      },
    ],
  } as AutomationConfig;
}

describe('applyConfigOperations', () => {
  it('does not mutate the config it is given', () => {
    const config = baseConfig();
    const snapshot = JSON.stringify(config);
    applyConfigOperations(config, [{ op: 'delete-step', stepId: 'a' }]);
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it('appends a step at the top level', () => {
    const out = applyConfigOperations(baseConfig(), [{ op: 'add-step', step: action('new') }]);
    expect(out.steps.map(s => s.id)).toEqual(['a', 'cond', 'sw', 'new']);
  });

  it('inserts at an explicit index', () => {
    const out = applyConfigOperations(baseConfig(), [
      { op: 'add-step', step: action('new'), index: 0 },
    ]);
    expect(out.steps[0]!.id).toBe('new');
  });

  it('adds into a CONDITIONAL branch', () => {
    const out = applyConfigOperations(baseConfig(), [
      { op: 'add-step', step: action('t2'), parentId: 'cond', branch: 'if_true' },
      { op: 'add-step', step: action('f2'), parentId: 'cond', branch: 'if_false' },
    ]);
    const cond = out.steps.find(s => s.id === 'cond') as never as {
      config: { if_true: AutomationStepConfig[]; if_false: AutomationStepConfig[] };
    };
    expect(cond.config.if_true.map(s => s.id)).toEqual(['t1', 't2']);
    expect(cond.config.if_false.map(s => s.id)).toEqual(['f1', 'f2']);
  });

  it('adds into a SWITCH case and its default', () => {
    const out = applyConfigOperations(baseConfig(), [
      { op: 'add-step', step: action('c2'), parentId: 'sw', branch: { caseIndex: 0 } },
      { op: 'add-step', step: action('d2'), parentId: 'sw', branch: 'default' },
    ]);
    const sw = out.steps.find(s => s.id === 'sw') as never as {
      config: { cases: Array<{ steps: AutomationStepConfig[] }>; default: AutomationStepConfig[] };
    };
    expect(sw.config.cases[0]!.steps.map(s => s.id)).toEqual(['c1', 'c2']);
    expect(sw.config.default.map(s => s.id)).toEqual(['d1', 'd2']);
  });

  it('finds and updates a step nested inside a branch, merging config by default', () => {
    const out = applyConfigOperations(baseConfig(), [
      { op: 'update-step', stepId: 't1', config: { extra: true } },
    ]);
    const cond = out.steps.find(s => s.id === 'cond') as never as {
      config: { if_true: Array<{ config: Record<string, unknown> }> };
    };
    expect(cond.config.if_true[0]!.config).toEqual({ text: 't1', extra: true });
  });

  it('replaces config wholesale when replace is set', () => {
    const out = applyConfigOperations(baseConfig(), [
      { op: 'update-step', stepId: 'a', config: { only: 1 }, replace: true },
    ]);
    expect((out.steps[0] as { config: unknown }).config).toEqual({ only: 1 });
  });

  it('deletes a deeply nested step', () => {
    const out = applyConfigOperations(baseConfig(), [{ op: 'delete-step', stepId: 'c1' }]);
    const sw = out.steps.find(s => s.id === 'sw') as never as {
      config: { cases: Array<{ steps: AutomationStepConfig[] }> };
    };
    expect(sw.config.cases[0]!.steps).toEqual([]);
  });

  it('moves a step from a branch to the top level', () => {
    const out = applyConfigOperations(baseConfig(), [{ op: 'move-step', stepId: 't1', index: 0 }]);
    expect(out.steps[0]!.id).toBe('t1');
    const cond = out.steps.find(s => s.id === 'cond') as never as {
      config: { if_true: AutomationStepConfig[] };
    };
    expect(cond.config.if_true).toEqual([]);
  });

  it('refuses to move a control-flow step inside itself', () => {
    expect(() =>
      applyConfigOperations(baseConfig(), [
        { op: 'move-step', stepId: 'cond', parentId: 'cond', branch: 'if_true' },
      ]),
    ).toThrow(ConfigOpError);
  });

  it('rejects a duplicate step id', () => {
    expect(() =>
      applyConfigOperations(baseConfig(), [{ op: 'add-step', step: action('a') }]),
    ).toThrow(/already exists/);
  });

  it('rejects an unknown step id', () => {
    expect(() =>
      applyConfigOperations(baseConfig(), [{ op: 'delete-step', stepId: 'nope' }]),
    ).toThrow(/not found/);
  });

  it('rejects adding under a non-control-flow parent', () => {
    expect(() =>
      applyConfigOperations(baseConfig(), [
        { op: 'add-step', step: action('x'), parentId: 'a' },
      ]),
    ).toThrow(/cannot contain steps/);
  });

  it('sets a CONDITIONAL condition but refuses one on a SWITCH', () => {
    const cond = { variable: '{{context.z}}', operator: 'eq', value: 9 } as never;
    const out = applyConfigOperations(baseConfig(), [
      { op: 'set-condition', stepId: 'cond', condition: cond },
    ]);
    expect(
      (out.steps.find(s => s.id === 'cond') as never as { config: { condition: unknown } }).config
        .condition,
    ).toEqual(cond);

    expect(() =>
      applyConfigOperations(baseConfig(), [
        { op: 'set-condition', stepId: 'sw', condition: cond },
      ]),
    ).toThrow(/not a CONDITIONAL/);
  });

  it('sets a SWITCH case condition and rejects a bad index', () => {
    const cond = { variable: '{{context.z}}', operator: 'eq', value: 9 } as never;
    const out = applyConfigOperations(baseConfig(), [
      { op: 'set-case-condition', stepId: 'sw', caseIndex: 0, condition: cond },
    ]);
    const sw = out.steps.find(s => s.id === 'sw') as never as {
      config: { cases: Array<{ condition: unknown }> };
    };
    expect(sw.config.cases[0]!.condition).toEqual(cond);

    expect(() =>
      applyConfigOperations(baseConfig(), [
        { op: 'set-case-condition', stepId: 'sw', caseIndex: 5, condition: cond },
      ]),
    ).toThrow(/no case at index/);
  });

  it('replaces the trigger, keeping config when only a type is given', () => {
    const out = applyConfigOperations(baseConfig(), [
      { op: 'set-trigger', trigger: { type: 'TICKET_CREATED' } },
    ]);
    expect(out.trigger.type).toBe('TICKET_CREATED');
    expect(out.trigger.config).toEqual({ channelIds: ['chan-1'] });
  });

  it('sets and clears the schedule', () => {
    const scheduled = { type: 'SCHEDULED', field: 'createdAt', offset: { amount: 1, unit: 'hours' } };
    const set = applyConfigOperations(baseConfig(), [
      { op: 'set-schedule', schedule: scheduled as never },
    ]);
    expect(set.schedule).toEqual(scheduled);

    const cleared = applyConfigOperations(set, [{ op: 'set-schedule', schedule: null }]);
    expect(cleared.schedule).toBeUndefined();
  });

  it('applies operations in order and is all-or-nothing on failure', () => {
    const config = baseConfig();
    expect(() =>
      applyConfigOperations(config, [
        { op: 'add-step', step: action('ok') },
        { op: 'delete-step', stepId: 'missing' },
      ]),
    ).toThrow(ConfigOpError);
    // The caller's config never gained the first step.
    expect(config.steps.map(s => s.id)).toEqual(['a', 'cond', 'sw']);
  });
});
