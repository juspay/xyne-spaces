/**
 * Calls, and the thing the whole shape exists for.
 *
 * The runtime case at the bottom is the one that matters: a call on a section,
 * a walk through two of its screens, and **one** fetch — because the section's
 * frame is still open. Leaving and coming back fetches again, which is right:
 * the answer is as old as the visit.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec } from '../json.js';
import { caseFor, sectionCaseFor } from '../locate.js';
import { readConversationalFlow } from '../read.js';
import { cycleStep, jumpStep, screenCase, screenRef, sectionCase, switchStep } from '../shape.js';
import { answer, answering, conversationOn, harness, parked, restoreFetch } from '../testing.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { addCall, callRef, moveCall, removeCall, setCall, setCallFallback } from './calls.js';

const REQUEST = {
  method: 'GET',
  // A literal address: the SSRF guard resolves names, and tests have no DNS.
  url: 'https://93.184.216.34/refunds/{{trigger.context.orderId}}',
  timeoutMs: 2_000,
  response: { type: 'json', bodySchema: { type: 'object', properties: { status: { type: 'string' } } } },
};

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
const choiceOf = (waitId: string) => `{{steps.${waitId}.output.resumeData.data.choice}}`;

/**
 * Support ─ Payments ─ Refund status
 *                    └ Charges
 * The two screens inside Payments quote what Payments fetches, by name.
 */
function support(): WorkflowConfig {
  const said = `Your refund is ${callRef('refund', 'body.status')}.`;
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: [
      cycleStep('root', { screen: 'root' }, [
        switchStep(
          'root_route',
          [
            screenCase('root', 'Support', [
              ask('ask_root', 'Hi! How can I help?', [['Payments', 'payments']]),
              jumpStep('go_root', 'root', { screen: choiceOf('ask_root') }),
            ]),
            sectionCase(['payments', 'refunds', 'charges'], 'Payments', [
              cycleStep('payments', { screen: screenRef() }, [
                switchStep(
                  'payments_route',
                  [
                    screenCase('payments', 'Payments', [
                      ask('ask_payments', 'Payments — what do you need?', [
                        ['Refund status', 'refunds'],
                        ['Charges', 'charges'],
                        ['Support', 'root'],
                      ]),
                      jumpStep('go_payments', 'root', { screen: choiceOf('ask_payments') }),
                    ]),
                    screenCase('refunds', 'Refund status', [
                      ask('ask_refunds', said, [['Charges', 'charges'], ['Support', 'root']]),
                      jumpStep('go_refunds', 'root', { screen: choiceOf('ask_refunds') }),
                    ]),
                    screenCase('charges', 'Charges', [
                      ask('ask_charges', `Charges. ${said}`, [['Refund status', 'refunds'], ['Support', 'root']]),
                      jumpStep('go_charges', 'root', { screen: choiceOf('ask_charges') }),
                    ]),
                  ],
                  [jumpStep('payments_unknown', 'root', { screen: 'root' })],
                ),
              ]),
            ]),
          ],
          [jumpStep('unknown', 'root', { screen: 'root' })],
        ),
      ]),
    ],
  } as unknown as WorkflowConfig;
}

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screenOf = (flow: ConversationalFlow, id: string): Screen => flow.screens.find((s) => s.id === id)!;
const fetching = () => addCall(support(), 'payments', { title: 'Refund', request: REQUEST });

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('where a call goes', () => {
  it('fetches for a section from outside its cycle, so everything inside can read it', () => {
    const { config, callId } = fetching();
    const flow = read(config);
    expect(callId).toBe('refund');

    const call = screenOf(flow, 'payments').calls[0]!;
    expect(call).toMatchObject({ id: 'refund', scope: 'section', method: 'GET', fields: [{ path: 'status', type: 'string' }] });
    // Before the section's own loop: that is what puts it in scope inside it.
    const steps = asArray(sectionCaseFor(config, flow, screenOf(flow, 'payments'))!['steps']);
    expect(steps.map((s) => asRec(s)['type'])).toEqual(['HTTP_REQUEST', 'CYCLE']);
    expect(new ConfigValidator(new ConnectorRegistry()).validate(config).issues).toEqual([]);
  });

  it('fetches for one screen from inside its case', () => {
    const { config } = addCall(support(), 'refunds', { title: 'Receipt', request: REQUEST });
    const flow = read(config);
    expect(screenOf(flow, 'refunds').calls[0]).toMatchObject({ id: 'receipt', scope: 'screen' });
    // The call, then the question. What follows is the jump, split because this
    // screen's answers land in two different frames.
    expect(asArray(caseFor(config, flow, screenOf(flow, 'refunds'))!['steps']).map((s) => asRec(s)['type'])).toEqual([
      'HTTP_REQUEST',
      'WAIT',
      'CONDITIONAL',
    ]);
  });

  it('fetches once for the whole conversation from before it starts', () => {
    const { config } = addCall(support(), 'root', { title: 'Customer', request: REQUEST });
    const flow = read(config);
    expect(screenOf(flow, 'root').calls[0]).toMatchObject({ id: 'customer', scope: 'conversation' });
    expect(asArray(config.steps).map((s) => asRec(s)['type'])).toEqual(['HTTP_REQUEST', 'CYCLE']);
  });

  it('refuses what the shape cannot mean', () => {
    expect(() => addCall(support(), 'refunds', { title: 'x', request: REQUEST }, 'section')).toThrow(/no section to fetch for/);
    expect(() => addCall(support(), 'payments', { title: 'x', request: REQUEST }, 'conversation')).toThrow(/before the conversation starts/);
    expect(() => addCall(support(), 'payments', { title: 'x', request: { method: 'GET' } })).toThrow(/needs an address/);
  });
});

describe('when a call cannot be reached', () => {
  it('writes the guard, and aims it at a frame that encloses it', () => {
    const { config, callId } = fetching();
    const next = setCallFallback(config, callId, 'root');
    const flow = read(next);
    expect(screenOf(flow, 'payments').calls[0]!.onFail).toBe('root');

    const [call, guard] = asArray(sectionCaseFor(next, flow, screenOf(flow, 'payments'))!['steps']).map(asRec);
    // Without this the run stops at the failed call and the conversation is gone.
    expect(call!['settings']).toEqual({ onError: 'continue' });
    const jump = asRec(asArray(asRec(guard!['config'])['if_true'])[0]);
    // The call sits outside Payments' own cycle, so only the conversation encloses it.
    expect(asRec(jump['config'])['target']).toBe('root');
    expect(new ConfigValidator(new ConnectorRegistry()).validate(next).issues).toEqual([]);
  });

  it('has nowhere to send anyone when it runs before the conversation', () => {
    const { config, callId } = addCall(support(), 'root', { title: 'Customer', request: REQUEST });
    expect(() => setCallFallback(config, callId, 'payments')).toThrow(/before the conversation starts/);
  });

  it('takes the guard away again', () => {
    const { config, callId } = fetching();
    const off = setCallFallback(setCallFallback(config, callId, 'root'), callId, null);
    expect(read(off).screens.find((s) => s.id === 'payments')!.calls[0]!.onFail).toBeUndefined();
    expect(JSON.stringify(off)).toBe(JSON.stringify(config));
  });
});

describe('changing a call', () => {
  it('rewrites the request and keeps where a failed one goes', () => {
    const { config, callId } = fetching();
    const withFallback = setCallFallback(config, callId, 'root');
    const changed = setCall(withFallback, callId, { title: 'Refund state', request: { ...REQUEST, url: 'https://93.184.216.34/v2' } });
    const call = read(changed).screens.find((s) => s.id === 'payments')!.calls[0]!;
    expect(call).toMatchObject({ title: 'Refund state', url: 'https://93.184.216.34/v2', onFail: 'root' });
  });

  it('refuses to remove one the wording still quotes, and says where', () => {
    const { config, callId } = fetching();
    expect(() => removeCall(config, callId)).toThrow(/what “Refund status” says/);
  });
});

describe('a conversation through a section that fetches', () => {
  it('fetches once on the way in, and not again while they stay inside', async () => {
    const { runtime } = harness();
    const service = answering({ status: 'on its way' });
    const id = await conversationOn(runtime, fetching().config, { orderId: 'A-1' });

    expect((await parked(runtime, id)).prompt).toBe('Hi! How can I help?');
    expect(service.calls).toBe(0);

    // In: the section's call runs, once.
    expect((await answer(runtime, id, 'payments')).prompt).toBe('Payments — what do you need?');
    expect(service.calls).toBe(1);
    expect(service.urls[0]).toBe('https://93.184.216.34/refunds/A-1');

    // Two screens inside it read the answer by name, and nothing is fetched again.
    expect((await answer(runtime, id, 'refunds')).prompt).toBe('Your refund is on its way.');
    expect(service.calls).toBe(1);
    expect((await answer(runtime, id, 'charges')).prompt).toBe('Charges. Your refund is on its way.');
    expect(service.calls).toBe(1);

    // Out, and the frame is gone; back in, and it is fetched afresh.
    expect((await answer(runtime, id, 'root')).prompt).toBe('Hi! How can I help?');
    expect(service.calls).toBe(1);
    expect((await answer(runtime, id, 'payments')).prompt).toBe('Payments — what do you need?');
    expect(service.calls).toBe(2);
  });
});

describe('moving a lookup', () => {
  const made = () => addCall(support(), 'refunds', { title: 'Refund', request: REQUEST });

  it('changes when it runs, because where it sits is what that means', () => {
    const { config, callId } = made();
    expect(callOn(read(config), 'refunds', callId).scope).toBe('screen');

    // Onto the section above it: now it runs once for everything in Payments.
    const moved = moveCall(config, callId, 'payments');
    const flow = read(moved);
    expect(screenOf(flow, 'refunds').calls).toEqual([]);
    expect(callOn(flow, 'payments', callId).scope).toBe('section');
    expect(new ConfigValidator(new ConnectorRegistry()).validate(moved).issues).toEqual([]);
  });

  it('carries the guard with it', () => {
    const { config, callId } = made();
    const moved = moveCall(setCallFallback(config, callId, 'root'), callId, 'payments');
    expect(callOn(read(moved), 'payments', callId).onFail).toBe('root');
  });

  it('refuses a place the lookup cannot run, and does nothing when it is already there', () => {
    const { config, callId } = made();
    expect(() => moveCall(config, callId, 'charges', 'section')).toThrow(/no section to fetch for/);
    expect(() => moveCall(config, callId, 'charges', 'conversation')).toThrow(/before the conversation starts/);
    expect(moveCall(config, callId, 'refunds')).toBe(config);
  });
});

/** The lookup as the screen it now belongs to reports it. */
function callOn(flow: ConversationalFlow, screenId: string, callId: string) {
  const call = screenOf(flow, screenId).calls.find((c) => c.id === callId);
  if (!call) throw new Error(`no ${callId} on ${screenId}`);
  return call;
}

