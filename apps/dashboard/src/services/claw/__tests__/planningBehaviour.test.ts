import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_MODE_PROMPT, applyBehaviour, readBehaviourDraft } from '../behaviourConfig';
import { clampMaxDelegationsPerRun, delegationBudgetOptions } from '../delegationBudget';

describe('planning settings in the behaviour config', () => {
  it('defaults match the runtime: tracking and TODO card on, budget 3, prefetch off', () => {
    const draft = readBehaviourDraft(undefined);
    expect(draft.planMode).toBe(false);
    expect(draft.planTracking).toBe(true);
    expect(draft.postTodos).toBe(true);
    expect(draft.maxDelegationsPerRun).toBe(3);
    expect(draft.prefetchContext).toBe(false);
  });

  it('reads stored values', () => {
    const draft = readBehaviourDraft({
      planMode: true,
      planTracking: false,
      postTodos: false,
      maxDelegationsPerRun: 10,
      prefetchContext: true,
    });
    expect(draft).toMatchObject({
      planMode: true,
      planTracking: false,
      postTodos: false,
      maxDelegationsPerRun: 10,
      prefetchContext: true,
    });
  });

  it('stores opt-outs only when turned off, and drops them again when turned back on', () => {
    const off = applyBehaviour(
      {},
      { ...readBehaviourDraft({}), planTracking: false, postTodos: false },
    );
    expect(off).toMatchObject({ planTracking: false, postTodos: false });
    const on = applyBehaviour(off, {
      ...readBehaviourDraft(off),
      planTracking: true,
      postTodos: true,
    });
    expect(on).not.toHaveProperty('planTracking');
    expect(on).not.toHaveProperty('postTodos');
  });

  it('stores a non-default delegation budget, clamped, and drops the default', () => {
    expect(
      applyBehaviour({}, { ...readBehaviourDraft({}), maxDelegationsPerRun: 8 }),
    ).toMatchObject({
      maxDelegationsPerRun: 8,
    });
    expect(
      applyBehaviour({}, { ...readBehaviourDraft({}), maxDelegationsPerRun: 99 }),
    ).toMatchObject({ maxDelegationsPerRun: 25 });
    expect(
      applyBehaviour(
        { maxDelegationsPerRun: 8 },
        { ...readBehaviourDraft({}), maxDelegationsPerRun: 3 },
      ),
    ).not.toHaveProperty('maxDelegationsPerRun');
  });

  it('stores prefetch only when on', () => {
    const on = applyBehaviour({}, { ...readBehaviourDraft({}), prefetchContext: true });
    expect(on).toMatchObject({ prefetchContext: true });
    expect(
      applyBehaviour(on, { ...readBehaviourDraft(on), prefetchContext: false }),
    ).not.toHaveProperty('prefetchContext');
  });

  it('keeps a custom plan-mode prompt only while plan mode is on', () => {
    const custom = 'Plan in three bullet points.';
    const on = applyBehaviour(
      {},
      { ...readBehaviourDraft({}), planMode: true, planModePrompt: custom },
    );
    expect(on).toMatchObject({ planMode: true, planModePrompt: custom });
    const defaultPrompt = applyBehaviour(
      {},
      {
        ...readBehaviourDraft({}),
        planMode: true,
        planModePrompt: DEFAULT_PLAN_MODE_PROMPT,
      },
    );
    expect(defaultPrompt).not.toHaveProperty('planModePrompt');
    const off = applyBehaviour(on, { ...readBehaviourDraft(on), planMode: false });
    expect(off).not.toHaveProperty('planMode');
    expect(off).not.toHaveProperty('planModePrompt');
  });

  it('leaves unrelated config keys alone', () => {
    const next = applyBehaviour(
      { tools: { custom: ['x'] }, color: 'red' },
      { ...readBehaviourDraft({}), planTracking: false },
    );
    expect(next).toMatchObject({ tools: { custom: ['x'] }, color: 'red', planTracking: false });
  });
});

describe('delegation budget', () => {
  it('clamps untrusted values like the runtime', () => {
    expect(clampMaxDelegationsPerRun(undefined)).toBe(3);
    expect(clampMaxDelegationsPerRun('7')).toBe(7);
    expect(clampMaxDelegationsPerRun(0)).toBe(1);
    expect(clampMaxDelegationsPerRun(40)).toBe(25);
    expect(clampMaxDelegationsPerRun(2.5)).toBe(3);
  });

  it('always offers the current value', () => {
    expect(delegationBudgetOptions(4)).toEqual([3, 4, 5, 6, 8, 10, 15, 20, 25]);
    expect(delegationBudgetOptions(3)).toEqual([3, 5, 6, 8, 10, 15, 20, 25]);
  });
});
