/**
 * Options that come from data.
 *
 * The engine already resolves a reference where an array is expected; what is
 * checked here is that the layer can say it, read it back, and that the run
 * offers what the lookup returned.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { createConversationalFlow } from '../create.js';
import { readConversationalFlow } from '../read.js';
import { answer, answering, conversationOn, harness, parked, restoreFetch } from '../testing.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { addCall } from './calls.js';
import { addScreen } from './screens.js';
import { optionsFrom, setOptionsFromLookup, setOptionsWritten } from './picklist.js';

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screenOf = (config: WorkflowConfig, id: string): Screen => read(config).screens.find((s) => s.id === id)!;

/** A flow whose first screen fetches the choices its next screen offers. */
function fetching(): { config: WorkflowConfig; callId: string } {
  const { config: made } = createConversationalFlow({ title: 'Support' });
  const { config: grown } = addScreen(made, { title: 'Your orders', parent: 'start' });
  return addCall(grown, 'start', {
    title: 'Orders',
    request: {
      method: 'GET',
      url: 'https://93.184.216.34/orders',
      response: {
        type: 'json',
        bodySchema: {
          type: 'object',
          properties: { choices: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } } } },
        },
      },
    },
  });
}

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('options that come from data', () => {
  it('is stored as the reference the step already understands, and reads back', () => {
    const { config, callId } = fetching();
    const prompt = screenOf(config, 'your_orders').prompts[0]!.id;
    const next = setOptionsFromLookup(config, prompt, callId, 'choices');

    const screen = screenOf(next, 'your_orders');
    expect(optionsFrom(screen, prompt)).toEqual({ callId, field: 'choices' });
    expect(screen.prompts[0]!.optionsFrom).toBe(`{{steps.${callId}.output.body.choices}}`);
    // Nothing is known about where they go until it runs.
    expect(screen.prompts[0]!.options).toEqual([]);
    expect(new ConfigValidator(new ConnectorRegistry()).validate(next).issues).toEqual([]);
  });

  it('goes back to a written list', () => {
    const { config, callId } = fetching();
    const prompt = screenOf(config, 'your_orders').prompts[0]!.id;
    const written = setOptionsWritten(setOptionsFromLookup(config, prompt, callId, 'choices'), prompt);
    expect(screenOf(written, 'your_orders').prompts[0]!.optionsFrom).toBeUndefined();
  });

  it('refuses a lookup the screen cannot read', () => {
    const { config } = fetching();
    const prompt = screenOf(config, 'your_orders').prompts[0]!.id;
    expect(() => setOptionsFromLookup(config, prompt, 'nothing', 'choices')).toThrow(/can’t read anything/);
  });

  it('offers what the lookup returned', async () => {
    const { config, callId } = fetching();
    const prompt = screenOf(config, 'your_orders').prompts[0]!.id;
    const flow = setOptionsFromLookup(config, prompt, callId, 'choices');

    answering({ choices: [{ label: 'Order A-1', value: 'done' }, { label: 'Order A-2', value: 'start' }] });
    const { runtime } = harness();
    const id = await conversationOn(runtime, flow, {});
    await parked(runtime, id);
    const asked = await answer(runtime, id, 'your_orders');

    const detail = await runtime.getExecutionDetail({} as never, id);
    const waiting = detail!.steps.find((s) => s.stepName === asked.nodePath)!;
    const data = JSON.parse(waiting.data ?? '{}') as { pauseState?: { form?: { fields?: Array<Record<string, unknown>> } } };
    const select = data.pauseState?.form?.fields?.find((f) => f['type'] === 'select');
    expect(select?.['options']).toEqual([
      { label: 'Order A-1', value: 'done' },
      { label: 'Order A-2', value: 'start' },
    ]);
  });
});
