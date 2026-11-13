import { describe, it, expect } from 'vitest';
import { DelayStep, DelayStepConfigSchema } from './delay.step.js';
import { createMockStepContext } from '../../../testing/mock-step-context.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { GateCategory } from '../../../types/known-types.js';

describe('DelayStep', () => {
  const step = new DelayStep();

  it('is a wait nobody can answer', async () => {
    const ctx = createMockStepContext();
    const before = Date.now();
    try {
      await step.execute({ afterMs: 60_000 }, ctx);
      expect.unreachable('should have thrown');
    } catch (err) {
      const pause = err as PauseStep;
      expect(pause.category).toBe(GateCategory.Delay);
      // The clock rides on `wakeAt`, which is what the runtime turns into the
      // queue's delay and the walk compares against.
      const at = new Date(pause.statePatch!['wakeAt'] as string).getTime();
      expect(at).toBeGreaterThanOrEqual(before + 60_000);
      expect(at).toBeLessThanOrEqual(Date.now() + 60_000);
    }
  });

  it('refuses a duration that is not one', async () => {
    const ctx = createMockStepContext();
    await expect(
      step.execute({ afterMs: 'soon' as unknown as number }, ctx),
    ).rejects.toThrow(/whole number of milliseconds/);
  });

  it('rejects a non-positive wait at config time', () => {
    expect(DelayStepConfigSchema.safeParse({ afterMs: 0 }).success).toBe(false);
    expect(DelayStepConfigSchema.safeParse({ afterMs: 1 }).success).toBe(true);
  });

  it('reports when it came back', async () => {
    expect((await step.onResume()).wokeAt).toMatch(/^\d{4}-/);
  });
});
