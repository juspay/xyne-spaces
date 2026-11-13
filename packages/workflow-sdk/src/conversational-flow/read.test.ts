/**
 * Reading the tree back out of the config.
 *
 * The flow here is written with `shape.ts`'s builders, so a passing test says
 * the two halves agree: what the editor writes is what the reader sees.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../engine/config-validator.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { readConversationalFlow } from './read.js';
import { cycleStep, jumpStep, screenCase, screenRef, sectionCase, switchStep } from './shape.js';
import type { ConversationalFlow, Screen } from './types.js';

const choiceOf = (waitId: string) => `{{steps.${waitId}.output.resumeData.data.choice}}`;

const ask = (id: string, prompt: string, options: Array<[string, string]>) => ({
  id,
  type: 'WAIT',
  config: {
    mode: 'approval',
    reason: prompt,
    prompt: [prompt],
    form: { fields: [{ type: 'select', name: 'choice', label: 'Choose one', options: options.map(([label, value]) => ({ label, value })) }] },
  },
});

const call = (id: string, url: string) => ({
  id,
  type: 'HTTP_REQUEST',
  title: 'Refund',
  config: {
    method: 'GET',
    url,
    response: { type: 'json', bodySchema: { type: 'object', properties: { status: { type: 'string' }, bank: { type: 'object', properties: { name: { type: 'string' } } } } } },
  },
});

/**
 * Support ─ Payments (fetches) ─ Refund status
 *         └ End of chat
 * and a call before the conversation itself, in scope everywhere.
 */
function flowConfig(): WorkflowConfig {
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: [
      call('fetch_customer', 'https://ops.internal/customers/{{trigger.context.customerId}}'),
      cycleStep('root', { screen: 'root' }, [
        switchStep(
          'root_route',
          [
            screenCase('root', 'Support', [
              ask('ask_root', 'Hi! How can I help?', [['Payments', 'payments'], ['End of chat', 'done']]),
              jumpStep('go_root', 'root', { screen: choiceOf('ask_root') }),
            ]),
            sectionCase(['payments', 'refunds'], 'Payments', [
              call('fetch_refund', 'https://ops.internal/refunds/{{trigger.context.orderId}}'),
              cycleStep('payments', { screen: screenRef() }, [
                switchStep(
                  'payments_route',
                  [
                    screenCase('payments', 'Payments', [
                      ask('ask_payments', 'Payments — what do you need?', [['Refund status', 'refunds'], ['Support', 'root']]),
                      jumpStep('go_payments', 'root', { screen: choiceOf('ask_payments') }),
                    ]),
                    screenCase('refunds', 'Refund status', [
                      ask('ask_refunds', 'Your refund is {{steps.fetch_refund.output.body.status}}.', [['Payments', 'payments']]),
                      jumpStep('go_refunds', 'payments', { screen: choiceOf('ask_refunds') }),
                    ]),
                  ],
                  [jumpStep('payments_unknown', 'root', { screen: 'root' })],
                ),
              ]),
            ]),
            screenCase('done', 'End of chat', [
              { id: 'finish', type: 'FINISH', config: { target: 'root', with: { outcome: 'done', message: 'Glad that helped.' } } },
            ]),
          ],
          [jumpStep('unknown', 'root', { screen: 'root' })],
        ),
      ]),
    ],
  } as unknown as WorkflowConfig;
}

function read(config: WorkflowConfig): ConversationalFlow {
  const flow = readConversationalFlow(config);
  if (!flow) throw new Error('not a conversational flow');
  return flow;
}

const screenOf = (flow: ConversationalFlow, id: string): Screen => {
  const screen = flow.screens.find((s) => s.id === id);
  if (!screen) throw new Error(`no screen "${id}"`);
  return screen;
};

describe('reading the tree', () => {
  it('is a legal workflow', () => {
    expect(new ConfigValidator(new ConnectorRegistry()).validate(flowConfig()).issues).toEqual([]);
  });

  it('places every screen where its case sits', () => {
    const flow = read(flowConfig());
    expect(flow.rootScreen).toBe('root');
    expect(flow.screens.map((s) => [s.id, s.kind, s.parent, s.depth])).toEqual([
      ['root', 'menu', undefined, 0],
      ['payments', 'menu', 'root', 1],
      ['refunds', 'message', 'payments', 2],
      ['done', 'end', 'root', 1],
    ]);
    expect(screenOf(flow, 'root').children).toEqual(['payments', 'done']);
    expect(screenOf(flow, 'payments').children).toEqual(['refunds']);
  });

  it('says which frames a screen sits inside', () => {
    const flow = read(flowConfig());
    expect(screenOf(flow, 'root').frames).toEqual(['root']);
    expect(screenOf(flow, 'refunds').frames).toEqual(['root', 'payments']);
  });

  it('gives each call to the screen whose frame it feeds', () => {
    const flow = read(flowConfig());
    // Before the conversation's own cycle: the first screen's, so everywhere.
    expect(screenOf(flow, 'root').calls.map((c) => c.id)).toEqual(['fetch_customer']);
    // Outside the section's cycle: the section's, so its subtree as well.
    expect(screenOf(flow, 'payments').calls[0]).toMatchObject({
      id: 'fetch_refund',
      title: 'Refund',
      method: 'GET',
      fields: [{ path: 'status', type: 'string' }, { path: 'bank.name', type: 'string' }],
    });
    expect(screenOf(flow, 'refunds').calls).toEqual([]);
  });

  it('reads what a screen says and where its options lead', () => {
    const flow = read(flowConfig());
    const refunds = screenOf(flow, 'refunds');
    // A plain reference to a call two frames out — which is the point of the shape.
    expect(refunds.prompts[0]!.says[0]).toBe('Your refund is {{steps.fetch_refund.output.body.status}}.');
    expect(refunds.prompts[0]!.options).toEqual([
      { label: 'Payments', value: 'payments', to: { kind: 'screen', screen: 'payments' }, back: true },
    ]);
    expect(screenOf(flow, 'root').prompts[0]!.options.map((o) => [o.value, o.back])).toEqual([
      ['payments', false],
      ['done', false],
    ]);
  });

  it('reads what a Finish reports and says', () => {
    const done = screenOf(read(flowConfig()), 'done');
    expect(done.endValue).toEqual({ outcome: 'done' });
    expect(done.endMessage).toBe('Glad that helped.');
  });

  it('is not a conversational flow without a cycle', () => {
    expect(readConversationalFlow({ trigger: { type: 'MANUAL', config: {} }, steps: [] } as unknown as WorkflowConfig)).toBeNull();
  });
});
