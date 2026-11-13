import { describe, it, expect } from 'vitest';
import { WaitForHumanStep, WaitForHumanConfigSchema } from './wait-for-human.step.js';
import { createMockStepContext } from '../../../testing/mock-step-context.js';
import { createMockContext } from '../../../testing/mock-context.js';
import { PauseStep } from '../../../engine/pause-step.js';
import { CONVERSATIONAL_FLOW_KIND, GateCategory } from '../../../types/known-types.js';

describe('WaitForHumanStep', () => {
  const step = new WaitForHumanStep();

  it('keeps the stored type, so no screen has to move', () => {
    // The wire value is what every conversational-flow screen already says.
    expect(step.type).toBe('WAIT');
    expect(step.kind).toBe('action');
    expect(step.category).toBe('flow');
  });

  describe('config schema', () => {
    it('takes a reason, and the interaction the author designed', () => {
      const parsed = WaitForHumanConfigSchema.safeParse({
        reason: 'sign off',
        prompt: ['Check the numbers'],
        display: [{ label: 'Total', value: 91 }],
        form: { fields: [{ type: 'textarea', name: 'why', label: 'Why' }] },
        actions: [{ key: 'approve', label: 'Approve', style: 'primary' }],
      });
      expect(parsed.success).toBe(true);
    });

    it('ignores a leftover mode, which is how stored screens keep parsing', () => {
      const parsed = WaitForHumanConfigSchema.safeParse({ mode: 'approval', reason: 'sign off' });
      expect(parsed.success).toBe(true);
      expect(parsed.success && 'mode' in parsed.data).toBe(false);
    });

    it('refuses a gate with nothing to say', () => {
      expect(WaitForHumanConfigSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('execute', () => {
    it('parks as a person\'s work, with what they are asked', async () => {
      const ctx = createMockStepContext();
      try {
        await step.execute(
          {
            reason: 'sign off',
            prompt: ['Check the numbers'],
            display: [{ label: 'Total', value: 91 }],
            actions: [{ key: 'approve', label: 'Approve' }],
          },
          ctx,
        );
        expect.unreachable('should have thrown');
      } catch (err) {
        const pause = err as PauseStep;
        expect(PauseStep.is(pause)).toBe(true);
        // The one gate the approvals inbox asks for.
        expect(pause.category).toBe(GateCategory.WaitingOnApprover);
        const state = pause.statePatch!['pauseState'] as Record<string, unknown>;
        expect(state['reason']).toBe('sign off');
        expect(state['prompt']).toEqual(['Check the numbers']);
        expect(state['display']).toEqual([{ label: 'Total', value: 91 }]);
        expect(state['actions']).toEqual([{ key: 'approve', label: 'Approve' }]);
      }
    });

    it('stamps dueAt when the gate opens, not when the run started', async () => {
      const ctx = createMockStepContext();
      const before = Date.now();
      try {
        await step.execute({ reason: 'sign off', dueInMs: 60_000 }, ctx);
        expect.unreachable('should have thrown');
      } catch (err) {
        const at = new Date((err as PauseStep).statePatch!['dueAt'] as string).getTime();
        expect(at).toBeGreaterThanOrEqual(before + 60_000);
        expect(at).toBeLessThanOrEqual(Date.now() + 60_000);
      }
    });

    it('omits dueAt when there is no deadline', async () => {
      const ctx = createMockStepContext();
      try {
        await step.execute({ reason: 'sign off' }, ctx);
        expect.unreachable('should have thrown');
      } catch (err) {
        // Absent, not null: "no deadline" must never read as overdue.
        expect((err as PauseStep).statePatch!['dueAt']).toBeUndefined();
      }
    });

    it('offers a choice only when its condition holds', async () => {
      const ctx = createMockStepContext({
        workflow: createMockContext({ steps: { score: { type: 'ECHO', output: { value: 9 } } } }),
      });
      try {
        await step.execute(
          {
            reason: 'pick',
            form: {
              fields: [
                {
                  type: 'select',
                  name: 'choice',
                  label: 'Choice',
                  options: [
                    { label: 'Escalate', value: 'esc', when: { variable: '{{steps.score.output.value}}', operator: 'gt', value: 5 } },
                    { label: 'Close', value: 'close', when: { variable: '{{steps.score.output.value}}', operator: 'lt', value: 5 } },
                  ],
                },
              ],
            },
          },
          ctx,
        );
        expect.unreachable('should have thrown');
      } catch (err) {
        const state = (err as PauseStep).statePatch!['pauseState'] as {
          form: { fields: Array<{ options?: Array<{ value: string }> }> };
        };
        // The offer is filtered, not the answer: nothing downstream has to know.
        expect(state.form.fields[0]!.options!.map((o) => o.value)).toEqual(['esc']);
      }
    });
  });

  describe('who the gate is addressed to', () => {
    const categoryWhen = async (metadata: Record<string, unknown>) => {
      const ctx = createMockStepContext({ workflow: createMockContext({ metadata }) });
      try {
        await step.execute({ reason: 'pick one' }, ctx);
        expect.unreachable('should have thrown');
      } catch (err) {
        return (err as PauseStep).category;
      }
    };

    it('waits on the customer when the workflow is a conversational flow', async () => {
      // Every screen of a flow is one of these, and they outnumber real
      // approvals several times over — so the inbox must not show them.
      expect(await categoryWhen({ kind: CONVERSATIONAL_FLOW_KIND })).toBe(GateCategory.WaitingOnConsumer);
    });

    it('waits on an approver anywhere else', async () => {
      expect(await categoryWhen({})).toBe(GateCategory.WaitingOnApprover);
      expect(await categoryWhen({ kind: 'something_else' })).toBe(GateCategory.WaitingOnApprover);
    });
  });

  describe('onResume', () => {
    it('hands on what the person answered', async () => {
      const ctx = createMockStepContext({ runtime: { isResuming: true } });
      const output = await step.onResume!(
        { resumePayload: { action: 'approve', feedback: 'looks right' } },
        { reason: 'sign off' },
        ctx,
      );
      expect(output.resumeData).toEqual({ action: 'approve', feedback: 'looks right' });
    });

    it('answers with an empty record when nothing was routed', async () => {
      const ctx = createMockStepContext({ runtime: { isResuming: true } });
      const output = await step.onResume!({}, { reason: 'sign off' }, ctx);
      expect(output.resumeData).toEqual({});
    });
  });

  describe('resolveOutputJsonSchema', () => {
    it('types the answer from the form the author declared', () => {
      const schema = step.resolveOutputJsonSchema({
        reason: 'sign off',
        form: { fields: [{ type: 'text', name: 'ticket', label: 'Ticket' }] },
      });
      const resume = (schema['properties'] as Record<string, Record<string, unknown>>)['resumeData']!;
      const data = (resume['properties'] as Record<string, Record<string, unknown>>)['data']!;
      expect(Object.keys(data['properties'] as Record<string, unknown>)).toEqual(['ticket']);
    });

    it('leaves the answer open when there is no form', () => {
      const schema = step.resolveOutputJsonSchema({ reason: 'sign off' });
      const resume = (schema['properties'] as Record<string, Record<string, unknown>>)['resumeData']!;
      const data = (resume['properties'] as Record<string, Record<string, unknown>>)['data']!;
      expect(data['additionalProperties']).toBe(true);
    });
  });
});
