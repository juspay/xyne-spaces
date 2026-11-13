/**
 * What the engine does with this shape, driven through the real runtime.
 *
 * It began as the probe that decided the design and stays as its contract —
 * everything else here reads and writes config, but these are the five
 * behaviours the whole thing rests on:
 *
 *   1. does a call outside a nested CYCLE stay in scope for every round inside it?
 *   2. does moving between screens of a section leave that call alone?
 *   3. does leaving the section unwind, and coming back run it again?
 *   4. does arriving at a screen *inside* the section from outside descend
 *      through the section, running the call on the way?
 *   5. does a WAIT nested two cycles deep resume into its own round, without
 *      re-running what already ran?
 *
 * The flow is hand-written rather than built, so a change to the builders can
 * never quietly change what is being asserted.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigValidator } from '../engine/config-validator.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import { answer, answering, conversationOn, harness, parked, restoreFetch } from './testing.js';
import type { WorkflowConfig } from '../types/workflow-config.js';

// ─── The shape under test ───

/** Whatever round we are in, this is that round's target screen. */
const SCREEN = '{{steps.__loop.output.input.screen}}';
const choiceOf = (waitId: string) => `{{steps.${waitId}.output.resumeData.data.choice}}`;

/** Screens of the Payments section — its case matches any of them. */
const INSIDE = ['payments', 'refunds'];

type Step = Record<string, unknown>;

const ask = (id: string, prompt: string, options: Array<[string, string]>): Step => ({
  id,
  type: 'WAIT',
  config: {
    mode: 'approval',
    reason: prompt,
    prompt: [prompt],
    form: { fields: [{ type: 'select', name: 'choice', label: 'Choose one', options: options.map(([label, value]) => ({ label, value })) }] },
  },
});

const goTo = (id: string, target: string, screen: string): Step => ({
  id,
  type: 'GO_TO',
  config: { target, with: { screen } },
});

/**
 * A screen inside the section: its answer may name a screen in the section or
 * outside it, so the jump is split — staying in keeps the section's frame (and
 * its call) alive, leaving unwinds to the conversation.
 */
const leaveOrStay = (id: string, waitId: string): Step => ({
  id,
  type: 'CONDITIONAL',
  config: {
    condition: { any: INSIDE.map((screen) => ({ variable: choiceOf(waitId), operator: 'eq', value: screen })) },
    if_true: [goTo(`${id}_in`, 'payments_scope', choiceOf(waitId))],
    if_false: [goTo(`${id}_out`, 'conversation', choiceOf(waitId))],
  },
});

function nestedFlow(): WorkflowConfig {
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: [
      {
        id: 'conversation',
        type: 'CYCLE',
        config: {
          input: { screen: 'start' },
          maxIterations: 50,
          body: [
            {
              id: 'route',
              type: 'SWITCH',
              config: {
                cases: [
                  {
                    label: 'Start',
                    condition: { variable: SCREEN, operator: 'eq', value: 'start' },
                    steps: [
                      ask('ask_start', 'Hi! How can I help?', [['Payments', 'payments'], ['Rides', 'rides']]),
                      goTo('go_start', 'conversation', choiceOf('ask_start')),
                    ],
                  },
                  {
                    // The section: its call, then its own loop holding its screens.
                    label: 'Payments',
                    condition: { any: INSIDE.map((screen) => ({ variable: SCREEN, operator: 'eq', value: screen })) },
                    steps: [
                      {
                        id: 'fetch_refund',
                        type: 'HTTP_REQUEST',
                        // A literal address: the SSRF guard resolves names, and this has no DNS.
                        config: { method: 'GET', url: 'https://93.184.216.34/refunds/{{trigger.context.orderId}}', timeoutMs: 2_000 },
                      },
                      {
                        id: 'payments_scope',
                        type: 'CYCLE',
                        config: {
                          input: { screen: SCREEN },
                          maxIterations: 50,
                          body: [
                            {
                              id: 'payments_route',
                              type: 'SWITCH',
                              config: {
                                cases: [
                                  {
                                    label: 'Payments',
                                    condition: { variable: SCREEN, operator: 'eq', value: 'payments' },
                                    steps: [
                                      ask('ask_payments', 'Payments — what do you need?', [['Refund status', 'refunds'], ['Rides', 'rides']]),
                                      leaveOrStay('after_payments', 'ask_payments'),
                                    ],
                                  },
                                  {
                                    label: 'Refund status',
                                    condition: { variable: SCREEN, operator: 'eq', value: 'refunds' },
                                    steps: [
                                      // The whole question: a plain step reference, from two frames in.
                                      ask('ask_refunds', 'Your refund is {{steps.fetch_refund.output.body.status}}.', [
                                        ['Payments', 'payments'],
                                        ['Rides', 'rides'],
                                      ]),
                                      leaveOrStay('after_refunds', 'ask_refunds'),
                                    ],
                                  },
                                ],
                                default: [goTo('payments_unknown', 'conversation', 'start')],
                              },
                            },
                          ],
                        },
                      },
                    ],
                  },
                  {
                    label: 'Rides',
                    condition: { variable: SCREEN, operator: 'eq', value: 'rides' },
                    steps: [
                      // "Refund status" from here is the arrival that matters: a screen
                      // two frames deep, reached from outside the section.
                      ask('ask_rides', 'Rides — what do you need?', [['Payments', 'payments'], ['Refund status', 'refunds']]),
                      goTo('go_rides', 'conversation', choiceOf('ask_rides')),
                    ],
                  },
                ],
                default: [goTo('unknown', 'conversation', 'start')],
              },
            },
          ],
        },
      },
    ],
  } as unknown as WorkflowConfig;
}

// ─── Driving it ───

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

// ─── The questions ───

describe('a section as a nested cycle', () => {
  it('is a legal workflow', () => {
    expect(new ConfigValidator(new ConnectorRegistry()).validate(nestedFlow()).issues).toEqual([]);
  });

  it('answers all five questions in one conversation', async () => {
    const { runtime } = harness();
    const service = answering({ status: 'on its way' });
    const id = await conversationOn(runtime, nestedFlow(), { orderId: 'A-1' });

    expect((await parked(runtime, id)).prompt).toBe('Hi! How can I help?');
    expect(service.calls).toBe(0);

    // (1) entering the section runs its call, once
    const payments = await answer(runtime, id, 'payments');
    expect(payments.prompt).toBe('Payments — what do you need?');
    expect(service.calls).toBe(1);

    // (2) a screen two frames in reads the call with a plain reference,
    //     and moving inside the section does not run it again
    const refunds = await answer(runtime, id, 'refunds');
    expect(refunds.prompt).toBe('Your refund is on its way.');
    expect(service.calls).toBe(1);
    expect(refunds.nodePath).toContain('payments_scope:body#');

    // (3) leaving unwinds to the conversation, and coming back runs it again
    const rides = await answer(runtime, id, 'rides');
    expect(rides.prompt).toBe('Rides — what do you need?');
    expect(service.calls).toBe(1);

    // (4) arriving at a screen INSIDE the section from outside descends
    //     through it — the call runs on the way, and the wording resolves
    const straightIn = await answer(runtime, id, 'refunds');
    expect(straightIn.prompt).toBe('Your refund is on its way.');
    expect(service.calls).toBe(2);
    expect(straightIn.nodePath).toContain('payments_scope:body#');

    // (5) nothing re-ran on the way: five answers, two entries, two calls
    expect(service.calls).toBe(2);
    expect(service.urls[0]).toBe('https://93.184.216.34/refunds/A-1');
  });
});
