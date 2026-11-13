import { describe, it, expect } from 'vitest';
import { WaitForWebhookStep, WaitForWebhookConfigSchema } from './wait-for-webhook.step.js';
import { createMockStepContext } from '../../../testing/mock-step-context.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { GateCategory } from '../../../types/known-types.js';

describe('WaitForWebhookStep', () => {
  const step = new WaitForWebhookStep();
  const RESULT = {
    type: 'object',
    required: ['result'],
    properties: { result: { type: 'string' }, buildNumber: { type: 'number' } },
  };

  it('parks as a machine gate, so no person is asked to answer it', async () => {
    const ctx = createMockStepContext();
    try {
      await step.execute({ payload: RESULT, onTimeout: 'fail' }, ctx);
      expect.unreachable('should have thrown');
    } catch (err) {
      const pause = err as PauseStep;
      expect(pause.category).toBe(GateCategory.WaitingOnApiCall);
      // The contract travels with the gate: `deliver` checks a body against
      // this rather than looking the config up again.
      expect(pause.statePatch!['contract']).toEqual(RESULT);
      expect(pause.statePatch!['wakeAt']).toBeUndefined();
    }
  });

  it('carries its deadline as the same clock a delay uses', async () => {
    const ctx = createMockStepContext();
    const before = Date.now();
    try {
      await step.execute({ deadlineMs: 3_600_000, onTimeout: 'continue' }, ctx);
      expect.unreachable('should have thrown');
    } catch (err) {
      const at = new Date((err as PauseStep).statePatch!['wakeAt'] as string).getTime();
      expect(at).toBeGreaterThanOrEqual(before + 3_600_000);
    }
  });

  it('types its body from the schema the author declared', () => {
    const schema = step.resolveOutputJsonSchema({ payload: RESULT });
    const props = schema['properties'] as Record<string, unknown>;
    // What makes `{{steps.x.output.body.result}}` check out downstream.
    expect(props['body']).toEqual(RESULT);
    expect(props['timedOut']).toEqual({ type: 'boolean' });
  });

  it('leaves the body open when nothing was declared', () => {
    const props = step.resolveOutputJsonSchema({})['properties'] as Record<string, Record<string, unknown>>;
    expect(props['body']!['additionalProperties']).toBe(true);
  });

  it('offers the payload field as a schema to edit', () => {
    const decorated = step.decorateConfigSchema({ properties: { payload: { type: 'object' } } });
    const props = decorated['properties'] as Record<string, Record<string, unknown>>;
    expect(props['payload']!['format']).toBe('json-schema');
  });

  describe('onResume', () => {
    it('hands on what arrived', async () => {
      const out = await step.onResume!(
        { delivery: { payload: { result: 'SUCCESS' }, receivedAt: '2026-10-14T00:00:00.000Z' } },
        { onTimeout: 'fail' },
        createMockStepContext(),
      );
      expect(out).toEqual({
        body: { result: 'SUCCESS' },
        receivedAt: '2026-10-14T00:00:00.000Z',
        timedOut: false,
      });
    });

    it('fails the run when the deadline passed and that is the author\'s choice', async () => {
      await expect(
        step.onResume!({}, { onTimeout: 'fail' }, createMockStepContext()),
      ).rejects.toThrow(/before the deadline/);
    });

    it('carries on with timedOut when the author asked for that instead', async () => {
      const out = await step.onResume!({}, { onTimeout: 'continue' }, createMockStepContext());
      expect(out).toEqual({ body: null, receivedAt: '', timedOut: true });
    });
  });

  it('defaults to failing on a deadline, because a silent carry-on is worse', () => {
    const parsed = WaitForWebhookConfigSchema.parse({});
    expect(parsed.onTimeout).toBe('fail');
  });
});
