/**
 * What a form's fields mean.
 *
 * A question's form holds how the screen is navigated — the field a jump carries,
 * the box a gate routes — and, from here, fields the author added to be answered
 * for their own sake. Which is which is settled by what reads them, never by the
 * order they happen to sit in, because an author who adds a rating would
 * otherwise have made it the menu.
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { readConversationalFlow } from './read.js';
import { setTypingAllowed } from './edit/prompts.js';
import { answerFor, readTurn, type RunView } from './turn.js';
import { conversationOn, harness, seen } from './testing.js';
import support from './__fixtures__/support-tree.json';

const ANYONE = {} as never;

type Field = Record<string, unknown>;

/** The support flow with `fields` put on the first screen's question, in order. */
function asking(fields: Field[], config: WorkflowConfig = support as unknown as WorkflowConfig): WorkflowConfig {
  const next = JSON.parse(JSON.stringify(config)) as WorkflowConfig;
  const steps = (next.steps as unknown[]).map((s) => s as Record<string, unknown>);
  const cycle = steps.find((s) => s['type'] === 'CYCLE')!;
  const body = (cycle['config'] as Record<string, unknown>)['body'] as Record<string, unknown>[];
  const cases = ((body.find((s) => s['type'] === 'SWITCH')!['config'] as Record<string, unknown>)['cases']) as Record<string, unknown>[];
  const own = cases.find((c) => ((c['steps'] as Record<string, unknown>[])[0]?.['id']) === 'ask_root')!;
  const wait = (own['steps'] as Record<string, unknown>[])[0]!;
  const form = (wait['config'] as Record<string, unknown>)['form'] as Record<string, unknown>;
  form['fields'] = fields;
  return next;
}


const CHOICE: Field = { type: 'select', name: 'choice', label: 'Choose one', options: [
  { label: 'Rides', value: 'rides' }, { label: 'Payments', value: 'payments' }, { label: 'Account', value: 'account' },
] };
const MESSAGE: Field = { type: 'text', name: 'message', label: 'Or type your question' };
const RATING: Field = { type: 'select', name: 'rating', label: 'How did we do?', options: [
  { label: '1', value: '1' }, { label: '5', value: '5' },
] };
const COMMENT: Field = { type: 'textarea', name: 'comment', label: 'Anything to add?' };

function promptOf(config: WorkflowConfig) {
  const flow = readConversationalFlow(config)!;
  return flow.screens.find((s) => s.id === flow.rootScreen)!.prompts[0]!;
}

/** Start a conversation and read the turn it opens on. */
async function opened(config: WorkflowConfig): Promise<{ run: RunView; turn: ReturnType<typeof readTurn> }> {
  const { runtime } = harness();
  const id = await conversationOn(runtime, config, { orderId: 'A-1' });
  const run = await seen(runtime, id);
  return { run, turn: readTurn(run) };
}

describe('which fields navigate', () => {
  it('is settled by what reads them, not by the order they sit in', () => {
    // A rating put first would be the menu if the first select won.
    const prompt = promptOf(asking([RATING, CHOICE, MESSAGE]));
    expect(prompt.choiceField).toBe('choice');
    expect(prompt.options.map((o) => o.value)).toEqual(['rides', 'payments', 'account']);
    expect(prompt.textField).toBe('message');
    expect(prompt.freeText).toEqual({ kind: 'screen', screen: 'classify' });
  });

  it('keeps a box nothing routes out of the router’s way', () => {
    // `comment` sits before the box the gate tests; the first text field would
    // have made what they type about the screen into a message to classify.
    const prompt = promptOf(asking([CHOICE, COMMENT, MESSAGE]));
    expect(prompt.textField).toBe('message');
    expect(prompt.freeText).toEqual({ kind: 'screen', screen: 'classify' });
  });

  it('offers the answers to the caller as fields, and the rest as the reply', async () => {
    const { turn } = await opened(asking([RATING, CHOICE, COMMENT, MESSAGE]));
    expect(turn.reply?.options.map((o) => o.id)).toEqual(['rides', 'payments', 'account']);
    expect(turn.reply?.text.allowed).toBe(true);
    expect(turn.reply?.fields?.map((f) => f.name)).toEqual(['rating', 'comment']);
  });
});

describe('answering a form', () => {
  it('fills the one box they can type into when the channel only types', async () => {
    // No routed box, one text answer: on WhatsApp everything arrives as text.
    const config = asking([CHOICE, { type: 'text', name: 'ride_id', label: 'Ride number' }],
      setTypingAllowed(support as unknown as WorkflowConfig, 'root', false));
    const { run, turn } = await opened(config);
    // It takes typed text and says which field the box is: the contract would
    // be lying if it said no and then accepted it.
    expect(turn.reply?.text).toEqual({ allowed: true, label: 'Ride number', fills: 'ride_id' });

    const { payload } = answerFor(run, turn.turnId!, { text: 'A-1' });
    expect((payload['data'] as Record<string, unknown>)['ride_id']).toBe('A-1');
  });

  it('leaves a required field on an ordinary screen exactly as it was', async () => {
    // Required belongs to a question, which is the only place the editor
    // offers it. A WAIT written anywhere else answers as it always did.
    const config = asking([CHOICE, { type: 'text', name: 'ride_id', label: 'Ride number', required: true }, MESSAGE]);
    const { run, turn } = await opened(config);
    const { payload } = answerFor(run, turn.turnId!, { choice: 'payments' });
    expect((payload['data'] as Record<string, unknown>)['choice']).toBe('payments');
  });
});
