/**
 * The requirement, end to end: a lookup answers with a ride's fare, and the
 * screen shows the breakdown.
 *
 * Built with the same edit functions the editor calls, validated as the editor
 * validates, and run through the real runtime with the real payload — so what
 * this asserts is what a customer reads.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigValidator } from '../engine/config-validator.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import { createConversationalFlow } from './create.js';
import { readConversationalFlow } from './read.js';
import { addCall } from './edit/calls.js';
import { setPromptSays } from './edit/prompts.js';
import { answering, conversationOn, harness, parked, restoreFetch } from './testing.js';
import { declaredFields } from './calls.js';
import { toExpressionValue } from '../expression/format.js';
import { writeComputation } from '../expression/form/write.js';

/** Trimmed from the payload the lookup really returns. */
const RIDE = {
  rideStatus: 'COMPLETED',
  actualFare: 91,
  fareBreakup: [
    { description: 'BASE_FARE', amount: { amount: 36, currency: 'INR' } },
    { description: 'Waiting Charges', amount: { amount: 0, currency: 'INR' } },
    { description: 'Cancellation Charges', amount: { amount: 55, currency: 'INR' } },
  ],
};

/** What "paste a sample response" writes, as a schema. */
const BODY_SCHEMA = {
  type: 'object',
  properties: {
    rideStatus: { type: 'string' },
    actualFare: { type: 'integer' },
    fareBreakup: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          amount: {
            type: 'object',
            properties: { amount: { type: 'integer' }, currency: { type: 'string' } },
          },
        },
      },
    },
  },
};

const REQUEST = {
  method: 'GET',
  // A literal address: the SSRF guard resolves names and tests have no DNS.
  url: 'https://93.184.216.34/rides/{{trigger.context.rideId}}',
  timeoutMs: 2_000,
  response: { type: 'json', bodySchema: BODY_SCHEMA },
};

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('a fare breakdown, from pasted sample to what the customer reads', () => {
  /** The flow an author would build: a lookup, then a screen that quotes it. */
  function built(says: string[]): ReturnType<typeof createConversationalFlow>['config'] {
    const made = createConversationalFlow({ title: 'Ride support' });
    const first = readConversationalFlow(made.config)!.rootScreen;
    const { config } = addCall(made.config, first, { title: 'Ride', request: REQUEST });
    const flow = readConversationalFlow(config)!;
    const prompt = flow.screens.find((s) => s.id === first)!.prompts[0]!;
    return setPromptSays(config, prompt.id, says);
  }

  it('reads the sample into fields, items included', () => {
    const fields = declaredFields(BODY_SCHEMA);
    const breakup = fields.find((f) => f.path === 'fareBreakup')!;
    expect(breakup.type).toBe('array');
    // The thing that was missing: what each item holds.
    expect(breakup.itemFields?.map((f) => f.path)).toEqual([
      'description',
      'amount.amount',
      'amount.currency',
    ]);
  });

  it('shows every line of the breakdown, and the total', async () => {
    const list = writeComputation({
      kind: 'list',
      source: { path: 'steps.ride.output.body.fareBreakup' },
      template: '{{description}} = {{amount.amount}}',
      separator: '\n',
      empty: 'No charges.',
    })!;
    const total = writeComputation({
      kind: 'call',
      fn: '$sum',
      args: [
        {
          kind: 'list',
          of: [{ kind: 'value', path: 'steps.ride.output.body.fareBreakup', field: 'amount.amount' }],
        },
      ],
    })!;

    const config = built([
      `Here's your fare breakdown:\n${toExpressionValue(list)}`,
      `Total: ${toExpressionValue(total)}`,
    ]);

    // An author would not be allowed to save it otherwise.
    expect(new ConfigValidator(new ConnectorRegistry()).validate(config).issues).toEqual([]);

    const { runtime } = harness();
    const service = answering(RIDE);
    const id = await conversationOn(runtime, config, { rideId: 'R-7' });

    const shown = (await parked(runtime, id)).prompt;
    expect(service.calls).toBe(1);
    // Two messages, so a blank line between them — the screen says several
    // things, which is the editor's own behaviour, not the expression's.
    expect(shown).toBe(
      "Here's your fare breakdown:\n" +
        'BASE_FARE = 36\n' +
        'Waiting Charges = 0\n' +
        'Cancellation Charges = 55\n\n' +
        'Total: 91',
    );
  });

  it('says something rather than nothing when the ride has no charges', async () => {
    const list = writeComputation({
      kind: 'list',
      source: { path: 'steps.ride.output.body.fareBreakup' },
      template: '{{description}} = {{amount.amount}}',
      separator: '\n',
      empty: 'No charges on this ride.',
    })!;
    const config = built([`Here's your fare breakdown:\n${toExpressionValue(list)}`]);

    const { runtime } = harness();
    answering({ ...RIDE, fareBreakup: [] });
    const id = await conversationOn(runtime, config, { rideId: 'R-8' });

    expect((await parked(runtime, id)).prompt).toBe(
      "Here's your fare breakdown:\nNo charges on this ride.",
    );
  });
});
