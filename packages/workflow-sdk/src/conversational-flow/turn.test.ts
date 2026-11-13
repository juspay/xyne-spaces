/**
 * The turn contract: what a caller sees, driving the real support flow.
 *
 * One conversation, three taps, into Payments and out the other side. What is
 * asserted is everything an integrator depends on — what is said, what can be
 * tapped, where they are, what happened in between, and what the conversation
 * concluded — read the way the Conversation API reads it.
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../types/workflow-config.js';
import type { WorkflowRuntime } from '../runtime/workflow-runtime.js';
import { answerFor, readTranscript, readTurn, type RunView, type Turn } from './turn.js';
import { conversationOn, harness, seen } from './testing.js';
import { setPromptSays } from './edit/prompts.js';
import support from './__fixtures__/support-tree.json';

const config = support as unknown as WorkflowConfig;
const ANYONE = {} as never;

/** Payments → Refunds → Refund status → End of chat, which closes it. */
const CHOICES = ['payments', 'payments_refunds', 'payments_refund_status', 'done'];

/** Drive the conversation through the taps, reading the turn after each. */
async function drive(choices: string[]): Promise<{ turns: Turn[]; runtime: WorkflowRuntime; id: string; last: RunView }> {
  const { runtime } = harness();
  const id = await conversationOn(runtime, config, { orderId: 'A-1' });
  const turns: Turn[] = [readTurn(await seen(runtime, id))];

  for (const choice of choices) {
    const run = await seen(runtime, id);
    const turn = readTurn(run);
    if (!turn.turnId) break;
    const { nodePath, payload } = answerFor(run, turn.turnId, { choice });
    await runtime.resume(ANYONE, id, { data: payload as never, nodePath });
    turns.push(readTurn(await seen(runtime, id)));
  }
  return { turns, runtime, id, last: await seen(runtime, id) };
}

describe('a screen that says something worked out', () => {
  it('shows the total, not the expression', async () => {
    // The whole point of the feature, driven as a real conversation: three
    // amounts arrive with the conversation and the screen says their total.
    const { runtime } = harness();
    const id = await conversationOn(
      runtime,
      setPromptSays(config, 'ask_root', [
        'You have {% $count(trigger.context.items) %} charges totalling {% $sum(trigger.context.items.amount) %}.',
      ]),
      { orderId: 'A-1', items: [{ amount: 100 }, { amount: 20.5 }, { amount: 105 }] },
    );
    const turn = readTurn(await seen(runtime, id));

    expect(turn.messages.map((m) => m.text)).toEqual(['You have 3 charges totalling 225.5.']);
    // Still an ordinary turn — nothing about the question changed.
    expect(turn.turnId).not.toBeNull();
    expect(turn.reply?.options.some((o) => o.id === 'payments')).toBe(true);
  });

  it('adds up only the charges that match, which is the full requirement', async () => {
    // The shape the Calculate form writes, evaluated for real: narrow the list
    // with a predicate, read one field off what is left, total it.
    const { runtime } = harness();
    const id = await conversationOn(
      runtime,
      setPromptSays(config, 'ask_root', [
        'Fees come to {% $sum(trigger.context.items[tag = "fee"].amount) %} of {% $sum(trigger.context.items.amount) %}.',
      ]),
      {
        orderId: 'A-1',
        items: [
          { tag: 'fee', amount: 100 },
          { tag: 'tax', amount: 20.5 },
          { tag: 'fee', amount: 105 },
        ],
      },
    );
    const turn = readTurn(await seen(runtime, id));
    expect(turn.messages[0]!.text).toBe('Fees come to 205 of 225.5.');
  });

  it('reads a reference and an expression in the same sentence', async () => {
    const { runtime } = harness();
    const id = await conversationOn(
      runtime,
      setPromptSays(config, 'ask_root', [
        'Order {{trigger.context.orderId}} — {% $uppercase(trigger.context.tier) %}',
      ]),
      { orderId: 'A-1', tier: 'gold' },
    );
    const turn = readTurn(await seen(runtime, id));
    expect(turn.messages[0]!.text).toBe('Order A-1 — GOLD');
  });
});

describe('a screen that says several things', () => {
  it('sends them as separate messages, in the order they were written', async () => {
    const said = ['Hi!', 'I can help with rides, payments and your account.', 'What do you need?'];
    const { runtime } = harness();
    const id = await conversationOn(runtime, setPromptSays(config, 'ask_root', said), {});
    const turn = readTurn(await seen(runtime, id));

    expect(turn.messages.map((m) => m.text)).toEqual(said);
    // One utterance with a heading above it, not a heading above every line.
    expect(turn.messages.filter((m) => m.header !== undefined)).toHaveLength(1);
    expect(turn.messages[0]!.header).toBeDefined();
    // Still one turn: several messages are not several questions.
    expect(turn.turnId).not.toBeNull();
    expect(turn.reply?.options.some((o) => o.id === 'payments')).toBe(true);
  });

  it('leaves out what was written and then cleared', async () => {
    const { runtime } = harness();
    const id = await conversationOn(runtime, setPromptSays(config, 'ask_root', ['Hi!', '', 'What do you need?']), {});
    const turn = readTurn(await seen(runtime, id));
    // An empty box is a box the author has not filled, not a blank bubble.
    expect(turn.messages.map((m) => m.text)).toEqual(['Hi!', 'What do you need?']);
  });
});

describe('a turn', () => {
  it('opens with the first screen, what it says and what can be tapped', async () => {
    const { runtime } = harness();
    const id = await conversationOn(runtime, config, {});
    const turn = readTurn(await seen(runtime, id));

    expect(turn.status).toBe('awaiting_reply');
    expect(turn.screen).toMatchObject({ id: 'root', kind: 'menu', path: ['Support'] });
    expect(turn.messages.map((m) => m.source)).toEqual(['flow']);
    expect(turn.messages[0]!.text.length).toBeGreaterThan(0);
    expect(turn.reply?.options.some((o) => o.id === 'payments')).toBe(true);
    // The first screen has nowhere to go back to, so nothing is marked as such.
    expect(turn.reply?.options.every((o) => o.kind !== 'back')).toBe(true);
    expect(turn.reply?.text).toBeTruthy();
  });

  it('says where they are as they go deeper', async () => {
    const { turns } = await drive(CHOICES);

    expect(turns.map((t) => t.screen?.id)).toEqual([
      'root',
      'payments',
      'payments_refunds',
      'payments_refund_status',
      // Once it has ended there is no screen to be on.
      undefined,
    ]);
    expect(turns[1]!.screen?.path).toEqual(['Support', 'Payments']);
    expect(turns[2]!.screen?.path).toEqual(['Support', 'Payments', 'Refunds']);
    // Each screen offers its way back to the screens above it, and the last one
    // offers the way out.
    expect(turns[2]!.reply?.options.filter((o) => o.kind === 'back').map((o) => o.id)).toEqual(['payments', 'root']);
    expect(turns[3]!.reply?.options.some((o) => o.kind === 'finish')).toBe(true);
  });

  it('reports what they tapped, and where it took them', async () => {
    const { turns } = await drive(CHOICES);
    const events = turns[1]!.events;

    expect(events.some((e) => e.type === 'tapped')).toBe(true);
    expect(JSON.stringify(events)).toContain('payments');
  });

  it('ends: what it says last, and what the run reports', async () => {
    const { turns, last } = await drive(CHOICES);
    const closing = turns.at(-1)!;

    expect(closing.status).toBe('finished');
    expect(closing.turnId).toBeNull();
    // This flow's ending says nothing, so nothing is said; what it reports is
    // the outcome its author gave it.
    expect(closing.messages).toEqual([]);

    const transcript = readTranscript(last);
    expect(transcript.status).toBe('finished');
    expect(transcript.outcome).toEqual({ resolution: 'closed' });
    // Everything asked and answered, in the order it happened.
    expect(transcript.entries.filter((e) => e.type === 'asked').length).toBeGreaterThanOrEqual(3);
    expect(transcript.entries.filter((e) => e.type === 'tapped').length).toBe(CHOICES.length);
  });

  it('answers a turn by resuming the step it names', async () => {
    const { runtime } = harness();
    const id = await conversationOn(runtime, config, {});
    const run = await seen(runtime, id);
    const turn = readTurn(run);

    expect(() => answerFor(run, turn.turnId!, { choice: 'nowhere' })).toThrow(/isn’t one of the options/);
    expect(() => answerFor(run, turn.turnId!, {})).toThrow(/Answer with a choice/);
    expect(answerFor(run, turn.turnId!, { choice: 'payments' }).nodePath).toBe(turn.turnId);
  });
});
