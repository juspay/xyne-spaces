import { describe, expect, it } from 'vitest';
import type {
  ActionStepConfig,
  AutomationConfig,
  AutomationStepConfig,
  ConditionalStepConfig,
  SwitchStepConfig,
  ValidationIssue,
} from '../../Automation.types';
import {
  ROOT_CONTAINER,
  buildFlowItems,
  buildPathPrefix,
  findItemForIssuePath,
  getEdgeInsertTarget,
  getInsertAfterTarget,
  getStepAtPath,
  insertStepAtPath,
  isDescendantPath,
  findUnknownSummaryKeys,
  summarizeStepConfig,
  issuesUnderPath,
  moveStepAtPath,
  removeStepAtPath,
  updateStepAtPath,
} from './FlowAutomationView.utils';
import type { ViewStepPath } from './FlowAutomationView.types';

const action = (id: string): ActionStepConfig => ({ id, type: 'SEND_MESSAGE', config: {} });

const conditional = (
  id: string,
  ifTrue: AutomationStepConfig[] = [],
  ifFalse: AutomationStepConfig[] = [],
): ConditionalStepConfig => ({
  id,
  type: 'CONDITIONAL',
  config: {
    condition: { variable: '', operator: 'eq', value: '' },
    if_true: ifTrue,
    if_false: ifFalse,
  },
});

const switchStep = (
  id: string,
  cases: AutomationStepConfig[][],
  fallback: AutomationStepConfig[] = [],
): SwitchStepConfig => ({
  id,
  type: 'SWITCH',
  config: {
    cases: cases.map(steps => ({
      condition: { variable: 'x', operator: 'eq', value: '1' },
      steps,
    })),
    default: fallback,
  },
});

const makeConfig = (steps: AutomationStepConfig[]): AutomationConfig =>
  ({ trigger: { type: 'MESSAGE_POSTED', config: {} }, steps }) as AutomationConfig;

const issue = (path: string): ValidationIssue =>
  ({ path, message: `bad ${path}`, code: 'REQUIRED' }) as unknown as ValidationIssue;

const ids = (config: AutomationConfig): string[] => {
  const out: string[] = [];
  const walk = (steps: AutomationStepConfig[]): void => {
    for (const step of steps) {
      out.push(step.id);
      if (step.type === 'CONDITIONAL') {
        const c = step as ConditionalStepConfig;
        walk(c.config.if_true);
        walk(c.config.if_false ?? []);
      }
      if (step.type === 'SWITCH') {
        const s = step as SwitchStepConfig;
        s.config.cases.forEach(c => walk(c.steps));
        walk(s.config.default);
      }
    }
  };
  walk(config.steps);
  return out;
};

describe('buildFlowItems', () => {
  it('uses step ids as node ids and adds an end placeholder', () => {
    const items = buildFlowItems(makeConfig([action('a'), action('b')]), []);
    expect(items.map(i => i.id)).toEqual(['trigger', 'a', 'b', 'add:root']);
    expect(items.find(i => i.id === 'b')?.parentIds).toEqual(['a']);
    expect(items.find(i => i.id === 'add:root')?.insert).toEqual({
      container: ROOT_CONTAINER,
      index: 2,
    });
  });

  it('merges from a placeholder for empty branches and from the last step otherwise', () => {
    const items = buildFlowItems(makeConfig([conditional('c', [action('t1'), action('t2')])]), []);
    const merge = items.find(i => i.id === 'merge:c');
    expect(merge?.parentIds).toEqual(['t2', 'empty:c:if_false']);
    const placeholder = items.find(i => i.id === 'empty:c:if_false');
    expect(placeholder?.insert).toEqual({ container: ['root', 0, 'if_false'], index: 0 });
    expect(items.find(i => i.id === 'add:root')?.parentIds).toEqual(['merge:c']);
  });

  it('handles a conditional nested inside a switch case', () => {
    const config = makeConfig([
      switchStep('s', [[conditional('c', [action('x')])]], [action('d')]),
    ]);
    const items = buildFlowItems(config, []);
    const nested = items.find(i => i.id === 'c');
    expect(nested?.path).toEqual(['root', 0, 'case:0', 0]);
    expect(nested?.stepNumber).toBe('1.1');
    expect(items.find(i => i.id === 'x')?.path).toEqual(['root', 0, 'case:0', 0, 'if_true', 0]);
    expect(items.find(i => i.id === 'merge:s')?.parentIds).toEqual(['merge:c', 'd']);
  });

  it('hides branches of collapsed control steps', () => {
    const config = makeConfig([conditional('c', [action('x')])]);
    const items = buildFlowItems(config, [], { collapsed: new Set(['c']) });
    expect(items.some(i => i.id === 'x')).toBe(false);
    expect(items.find(i => i.id === 'merge:c')?.parentIds).toEqual(['c']);
  });
});

describe('path mutations', () => {
  const config = makeConfig([
    action('a'),
    conditional('c', [action('t')], [action('f1'), action('f2')]),
    switchStep('s', [[action('k1'), conditional('deep', [action('d1'), action('d2')])]]),
  ]);

  it('updates at root, if_false, case:n and two levels deep', () => {
    for (const [path, id] of [
      [['root', 0], 'a'],
      [['root', 1, 'if_false', 1], 'f2'],
      [['root', 2, 'case:0', 0], 'k1'],
      [['root', 2, 'case:0', 1, 'if_true', 0], 'd1'],
    ] as const) {
      const next = updateStepAtPath(config, [...path], action(`${id}-new`));
      expect(getStepAtPath(next, [...path])?.id).toBe(`${id}-new`);
    }
  });

  it('removes at every depth', () => {
    expect(ids(removeStepAtPath(config, ['root', 0]))).not.toContain('a');
    expect(ids(removeStepAtPath(config, ['root', 1, 'if_false', 0]))).not.toContain('f1');
    expect(ids(removeStepAtPath(config, ['root', 2, 'case:0', 0]))).not.toContain('k1');
    const deep = removeStepAtPath(config, ['root', 2, 'case:0', 1, 'if_true', 1]);
    expect(ids(deep)).not.toContain('d2');
    expect(ids(deep)).toContain('d1');
  });

  it('moves within a container and is a no-op at the boundary', () => {
    const moved = moveStepAtPath(config, ['root', 1, 'if_false', 0], 1);
    expect(getStepAtPath(moved, ['root', 1, 'if_false', 0])?.id).toBe('f2');
    expect(moveStepAtPath(config, ['root', 1, 'if_true', 0], 1)).toEqual(config);
    expect(moveStepAtPath(config, ['root', 0], -1)).toEqual(config);
    expect(moveStepAtPath(config, ['root', 2, 'case:0', 1, 'if_true', 1], 1)).toEqual(config);
  });

  it('inserts into each container kind', () => {
    const cases: [(string | number)[], number, (string | number)[]][] = [
      [ROOT_CONTAINER, 1, ['root', 1]],
      [['root', 1, 'if_true'], 0, ['root', 1, 'if_true', 0]],
      [['root', 1, 'if_false'], 2, ['root', 1, 'if_false', 2]],
      [['root', 2, 'case:0'], 1, ['root', 2, 'case:0', 1]],
      [['root', 2, 'default'], 0, ['root', 2, 'default', 0]],
      [['root', 2, 'case:0', 1, 'if_false'], 0, ['root', 2, 'case:0', 1, 'if_false', 0]],
    ];
    for (const [container, index, expected] of cases) {
      const next = insertStepAtPath(config, container, index, action('new'));
      expect(getStepAtPath(next, expected)?.id).toBe('new');
      expect(ids(next)).toHaveLength(ids(config).length + 1);
    }
  });

  it('appends when the index is out of range and ignores unknown branches', () => {
    const appended = insertStepAtPath(config, ROOT_CONTAINER, undefined, action('new'));
    expect(appended.steps.at(-1)?.id).toBe('new');
    expect(insertStepAtPath(config, ['root', 0, 'if_true'], 0, action('new'))).toBe(config);
  });
});

describe('insert targets', () => {
  const config = makeConfig([action('a'), conditional('c', [action('t')])]);
  const items = buildFlowItems(config, []);
  const byId = (id: string) => items.find(i => i.id === id)!;

  it('inserts before the target step on step edges', () => {
    expect(getEdgeInsertTarget(byId('trigger'), byId('a'))).toEqual({
      container: ROOT_CONTAINER,
      index: 0,
    });
    expect(getEdgeInsertTarget(byId('c'), byId('t'))).toEqual({
      container: ['root', 1, 'if_true'],
      index: 0,
    });
  });

  it('appends to the branch on the edge into a merge', () => {
    expect(getEdgeInsertTarget(byId('t'), byId('merge:c'))).toEqual({
      container: ['root', 1, 'if_true'],
      index: 1,
    });
  });

  it('has no slot on placeholder edges', () => {
    expect(getEdgeInsertTarget(byId('c'), byId('empty:c:if_false'))).toBeUndefined();
  });

  it('inserts after a merge as after its control step', () => {
    expect(getInsertAfterTarget(byId('merge:c'))).toEqual({ container: ROOT_CONTAINER, index: 2 });
    expect(getInsertAfterTarget(byId('trigger'))).toEqual({ container: ROOT_CONTAINER, index: 0 });
  });
});

describe('validation paths', () => {
  it('builds the backend prefix for nested paths', () => {
    expect(buildPathPrefix(['root', 3])).toBe('steps[3]');
    expect(buildPathPrefix(['root', 1, 'if_false', 0, 'case:2', 4])).toBe(
      'steps[1].config.if_false[0].config.cases[2].steps[4]',
    );
  });

  it('agrees with issuesUnderPath and findItemForIssuePath', () => {
    const config = makeConfig([
      conditional('c', [], [switchStep('s', [[], [], [action('x')]])]),
      ...Array.from({ length: 10 }, (_, i) => action(`r${i}`)),
    ]);
    const items = buildFlowItems(config, []);
    const x = items.find(i => i.id === 'x')!;
    const path = `${buildPathPrefix(x.path)}.config.channelId`;
    expect(path).toBe('steps[0].config.if_false[0].config.cases[2].steps[0].config.channelId');
    expect(issuesUnderPath([issue(path)], x.path, 'action')).toHaveLength(1);
    expect(findItemForIssuePath(items, path)?.id).toBe('x');
    // steps[1] must not claim issues of steps[10].
    const r0 = items.find(i => i.id === 'r0')!;
    expect(issuesUnderPath([issue('steps[10].config.a')], r0.path, 'conditional')).toHaveLength(0);
    expect(findItemForIssuePath(items, 'steps[10].config.a')?.id).toBe('r9');
  });
});

describe('isDescendantPath', () => {
  it('matches steps nested in the branches of a control step only', () => {
    const config = makeConfig([conditional('c', [conditional('n', [action('x')])]), action('a')]);
    const items = buildFlowItems(config, []);
    const path = (id: string): ViewStepPath => items.find(i => i.id === id)!.path;
    expect(isDescendantPath(path('c'), path('x'))).toBe(true);
    expect(isDescendantPath(path('c'), path('n'))).toBe(true);
    expect(isDescendantPath(path('c'), path('c'))).toBe(false);
    expect(isDescendantPath(path('c'), path('a'))).toBe(false);
    expect(isDescendantPath(path('n'), path('c'))).toBe(false);
  });
});

describe('summarizeStepConfig', () => {
  it('uses only the allow-listed fields for the step type, in priority order', () => {
    expect(summarizeStepConfig('RUN_AGENT', { prompt: 'Hi', agentSlug: 'triage' })).toBe(
      'agent: triage',
    );
    expect(summarizeStepConfig('UPDATE_TICKET', { ticketId: 't1', priority: 'HIGH' })).toBe(
      'priority: HIGH',
    );
  });

  it('never falls back to unlisted fields', () => {
    expect(summarizeStepConfig('TRIGGER_WEBHOOK', { method: 'POST', body: 'x' })).toBeUndefined();
    expect(summarizeStepConfig('UNKNOWN_STEP', { someField: 'value' })).toBeUndefined();
    expect(summarizeStepConfig('CLOSE_TICKET', { ticketId: 't1' })).toBeUndefined();
  });

  it('keeps the webhook summary on the URL regardless of key order', () => {
    const summary = summarizeStepConfig('TRIGGER_WEBHOOK', {
      headers: { Authorization: 'enc:abc' },
      secretHeaders: ['Authorization'],
      url: 'https://example.com/hook',
    });
    expect(summary).toBe('url: https://example.com/hook');
  });

  it('redacts encrypted values even when the field is allow-listed', () => {
    expect(summarizeStepConfig('RUN_AGENT', { agentSlug: 'enc:deadbeef' })).toBe('agent: ••••••');
    expect(summarizeStepConfig('SEND_MESSAGE', { userIds: ['u1', 'enc:x'] })).toBe(
      'user ids: u1, ••••••',
    );
  });

  it('summarises a delay as its duration', () => {
    expect(summarizeStepConfig('DELAY', { amount: 2, unit: 'hours' })).toBe('wait: 2 hours');
    expect(summarizeStepConfig('DELAY', { amount: 1, unit: 'minutes' })).toBe('wait: 1 minute');
    expect(summarizeStepConfig('DELAY', { amount: 30 })).toBe('wait: 30 seconds');
    expect(summarizeStepConfig('DELAY', { unit: 'hours' })).toBeUndefined();
  });

  it('summarises a message with only content set', () => {
    expect(summarizeStepConfig('SEND_MESSAGE', { content: 'Hello team' })).toBe(
      'content: Hello team',
    );
  });

  it('uses trigger filters for trigger types', () => {
    expect(summarizeStepConfig('MESSAGE_RECEIVED', { channelIds: ['c1'], fireOnEdit: true })).toBe(
      'channel ids: c1',
    );
    expect(summarizeStepConfig('WEBHOOK', { bodySchema: { a: 'string' } })).toBeUndefined();
  });
});

describe('findUnknownSummaryKeys', () => {
  it('flags allow-listed keys the config schema does not declare', () => {
    const schema = { properties: { amount: {}, unit: {} } };
    expect(findUnknownSummaryKeys('DELAY', schema)).toEqual(['businessHoursOnly']);
    expect(findUnknownSummaryKeys('UNKNOWN_STEP', schema)).toEqual([]);
    expect(findUnknownSummaryKeys('DELAY', undefined)).toEqual([]);
  });
});
