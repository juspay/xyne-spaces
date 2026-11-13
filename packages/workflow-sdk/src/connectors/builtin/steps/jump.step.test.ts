import { describe, it, expect } from 'vitest';
import { FinishStep, GoToStep, JumpStepConfigSchema } from './jump.step.js';
import { BranchSignal } from '../../../engine/branch-signal.js';

describe('GoToStep and FinishStep', () => {
  const goToStep = new GoToStep();
  const finishStep = new FinishStep();

  it('has correct metadata', () => {
    expect(goToStep.type).toBe('GO_TO');
    expect(goToStep.kind).toBe('action');
    expect(goToStep.jumpKind).toBe('goto');
    expect(finishStep.type).toBe('FINISH');
    expect(finishStep.kind).toBe('action');
    expect(finishStep.jumpKind).toBe('finish');
  });

  describe('config schema', () => {
    it('requires a target and defaults with to {}', () => {
      expect(JumpStepConfigSchema.parse({ target: 'support' })).toEqual({ target: 'support', with: {} });
      expect(() => JumpStepConfigSchema.parse({ target: '' })).toThrow();
    });

    it('tags target for the builder loop picker', () => {
      const schema = goToStep.decorateConfigSchema({
        type: 'object',
        properties: { target: { type: 'string' }, with: { type: 'object' } },
      });
      expect((schema['properties'] as Record<string, Record<string, unknown>>)['target']).toEqual({
        type: 'string',
        format: 'loop-target',
      });
    });
  });

  it('GO_TO throws a goto signal carrying its value', async () => {
    const error = await goToStep
      .execute({ target: 'support', with: { screen: 'rides' } })
      .catch((err: unknown) => err);
    expect(BranchSignal.is(error)).toBe(true);
    expect((error as BranchSignal).signal).toEqual({
      kind: 'goto',
      target: 'support',
      value: { screen: 'rides' },
    });
  });

  it('FINISH throws a finish signal carrying its value', async () => {
    const error = await finishStep
      .execute({ target: 'support', with: { resolved: true } })
      .catch((err: unknown) => err);
    expect(BranchSignal.is(error)).toBe(true);
    expect((error as BranchSignal).signal).toEqual({
      kind: 'finish',
      target: 'support',
      value: { resolved: true },
    });
  });
});
