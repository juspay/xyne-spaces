import { describe, it, expect } from 'vitest';
import { readWorkflowConfig } from './read-config.js';

const wrap = (steps: unknown[]) =>
  JSON.stringify({ trigger: { type: 'MANUAL', config: {} }, steps });

describe('readWorkflowConfig', () => {
  it('leaves a stored screen exactly as it is', () => {
    // Every conversational-flow screen is one of these. If this moved, 500-odd
    // parked runs would resume against a step type the validator rejects.
    const raw = wrap([
      { id: 'ask_root', type: 'WAIT', config: { mode: 'approval', reason: 'Hi', form: { fields: [] } } },
    ]);
    const steps = readWorkflowConfig(raw).steps as Array<Record<string, unknown>>;
    expect(steps[0]!['type']).toBe('WAIT');
    expect(steps[0]!['config']).toEqual({ mode: 'approval', reason: 'Hi', form: { fields: [] } });
  });

  it('turns a delay wait into the step that can actually wake', () => {
    const steps = readWorkflowConfig(
      wrap([{ id: 'w', type: 'WAIT', config: { mode: 'delay', delayMs: 60_000 } }]),
    ).steps as Array<Record<string, unknown>>;
    expect(steps[0]!['type']).toBe('DELAY');
    expect(steps[0]!['config']).toEqual({ afterMs: 60_000 });
  });

  it('turns a webhook wait into the step that can actually be delivered to', () => {
    const steps = readWorkflowConfig(
      wrap([{ id: 'w', type: 'WAIT', config: { mode: 'webhook' } }]),
    ).steps as Array<Record<string, unknown>>;
    expect(steps[0]!['type']).toBe('WAIT_FOR_WEBHOOK');
    expect(steps[0]!['config']).toEqual({});
  });

  it('reaches a wait nested in a branch', () => {
    const config = readWorkflowConfig(
      wrap([
        {
          id: 'cond',
          type: 'CONDITIONAL',
          config: {
            condition: { variable: '{{trigger.x}}', operator: 'exists' },
            if_true: [{ id: 'w', type: 'WAIT', config: { mode: 'delay', delayMs: 5 } }],
          },
        },
      ]),
    );
    const branch = (config.steps[0]!.config as Record<string, unknown>)['if_true'] as Array<Record<string, unknown>>;
    expect(branch[0]!['type']).toBe('DELAY');
  });

  it('reads an empty config without complaint', () => {
    expect(readWorkflowConfig(null)).toEqual({});
  });
});
