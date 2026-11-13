/**
 * A question asked on the way into a section.
 *
 * Its WAIT sits before the frame, which is what the whole feature rests on: the
 * section's case is opened by its whole subtree, so however someone arrives they
 * pass through it, and everything inside can read what they answered without any
 * jump carrying it.
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { readConversationalFlow } from './read.js';
import { readQuestion } from './questions.js';
import { renameScreen } from './edit/screens.js';
import { setPromptSays } from './edit/prompts.js';
import { answerFor, readTranscript, readTurn } from './turn.js';
import { conversationOn, harness, seen } from './testing.js';
import type { PromptContext } from './prompt.js';
import type { Step } from './json.js';
import support from './__fixtures__/support-tree.json';

const ANYONE = {} as never;
const BASE = support as unknown as WorkflowConfig;

type Rec = Record<string, unknown>;

/** The support flow with `wait` (and optionally a guard) asked on the way into `sectionId`. */
function asking(sectionId: string, wait: Rec, guard?: Rec, config: WorkflowConfig = BASE): WorkflowConfig {
  const next = JSON.parse(JSON.stringify(config)) as WorkflowConfig;
  const cycle = (next.steps as Rec[]).find((s) => s['type'] === 'CYCLE')!;
  const body = (cycle['config'] as Rec)['body'] as Rec[];
  const cases = ((body.find((s) => s['type'] === 'SWITCH')!['config'] as Rec)['cases']) as Rec[];
  const own = cases.find((c) => (c['steps'] as Rec[]).some((s) => s['id'] === sectionId && s['type'] === 'CYCLE'))!;
  (own['steps'] as Rec[]).unshift(...(guard ? [wait, guard] : [wait]));
  return next;
}

const WHICH_RIDE: Rec = {
  id: 'ask_payments_entry',
  type: 'WAIT',
  config: {
    mode: 'approval',
    prompt: ['Which order is this about?'],
    form: { fields: [
      { type: 'text', name: 'order_id', label: 'Order number', required: true },
      { type: 'attachment', name: 'shot', label: 'Add a screenshot' },
    ] },
  },
};

/** The ways out, and the branch that acts on them. */
const WITH_A_WAY_OUT: { wait: Rec; guard: Rec } = {
  wait: {
    ...WHICH_RIDE,
    config: {
      ...(WHICH_RIDE['config'] as Rec),
      form: { fields: [
        ...((((WHICH_RIDE['config'] as Rec)['form'] as Rec)['fields']) as Rec[]),
        { type: 'select', name: 'choice', label: 'Or', options: [{ label: 'Main menu', value: 'root' }] },
      ] },
    },
  },
  guard: {
    id: 'leave_payments_entry',
    type: 'CONDITIONAL',
    config: {
      condition: { all: [
        { variable: '{{steps.ask_payments_entry.output.resumeData.data.choice}}', operator: 'exists' },
        { variable: '{{steps.ask_payments_entry.output.resumeData.data.choice}}', operator: 'neq', value: '' },
      ] },
      if_true: [{ id: 'left_payments_entry', type: 'GO_TO', config: { target: 'root', with: {
        screen: '{{steps.ask_payments_entry.output.resumeData.data.choice}}', text: '',
      } } }],
    },
  },
};

function screenOf(config: WorkflowConfig, id: string) {
  return readConversationalFlow(config)!.screens.find((s) => s.id === id)!;
}

describe('reading what a section asks on the way in', () => {
  it('reads the fields, what they are called, and what it says while asking', () => {
    const screen = screenOf(asking('payments', WHICH_RIDE), 'payments');
    expect(screen.questions[0]?.id).toBe('ask_payments_entry');
    expect(screen.questions[0]?.says).toEqual(['Which order is this about?']);
    expect(screen.questions[0]?.asks).toEqual([
      { kind: 'text', name: 'order_id', label: 'Order number', required: true, choices: [], multiple: false },
      { kind: 'attachment', name: 'shot', label: 'Add a screenshot', required: false, choices: [], multiple: false },
    ]);
    // The same shape a lookup's fields take, because the picker offers both alike.
    expect(screen.questions[0]?.answers).toEqual([
      { path: 'order_id', type: 'string' },
      { path: 'shot', type: 'object' },
    ]);
  });

  it('leaves the screen’s own question exactly as it was', () => {
    const asked = screenOf(asking('payments', WHICH_RIDE), 'payments');
    const plain = screenOf(BASE, 'payments');
    expect(asked.prompts).toEqual(plain.prompts);
    expect(asked.children).toEqual(plain.children);
    expect(asked.kind).toBe('menu');
  });

  it('is nobody else’s', () => {
    const flow = readConversationalFlow(asking('payments', WHICH_RIDE))!;
    expect(flow.screens.filter((s) => s.questions.length > 0).map((s) => s.id)).toEqual(['payments']);
  });

  it('is not read on a screen with no frame to be asked on the way into', () => {
    // A lone jump is how a screen that asks passes through to what it opened —
    // without a frame there was no way in, so it is not one.
    const flow = readConversationalFlow(BASE)!;
    expect(flow.screens.some((s) => s.kind === 'input')).toBe(false);
  });

  it('reads nothing where nothing is asked', () => {
    expect(readConversationalFlow(BASE)!.screens.every((s) => s.questions.length === 0)).toBe(true);
  });

  it('reads the ways out it offers, and where each goes', () => {
    const screen = screenOf(asking('payments', WITH_A_WAY_OUT.wait, WITH_A_WAY_OUT.guard), 'payments');
    expect(screen.questions[0]?.options).toEqual([
      { label: 'Main menu', value: 'root', to: { kind: 'screen', screen: 'root' }, back: true },
    ]);
    // The box it navigates by is not one of the things it asks for.
    expect(screen.questions[0]?.asks.map((a) => a.name)).toEqual(['order_id', 'shot']);
  });

  it('survives an edit, because settle has no reason to touch it', () => {
    const edited = renameScreen(asking('payments', WHICH_RIDE), 'payments_refunds', 'Money back');
    expect(screenOf(edited, 'payments').questions[0]?.asks.map((a) => a.name)).toEqual(['order_id', 'shot']);
    expect(screenOf(edited, 'payments').questions[0]?.header).toBe('Payments');
  });

  it('does not mistake something it asks for for the way out', () => {
    // A question may ask them to pick something; what the guard acts on is the
    // way out, and that is the only one that is not an answer.
    const ctx: PromptContext = { routeKey: 'screen', typeOf: new Map([['ask_it', 'WAIT']]) };
    const wait = {
      id: 'ask_it',
      type: 'WAIT',
      config: { form: { fields: [
        { type: 'select', name: 'selectedOptions', label: 'How did we do?', options: [{ label: '5', value: '5' }] },
        { type: 'select', name: 'choice', options: [{ label: 'Main menu', value: 'root' }] },
      ] } },
    } as unknown as Step;
    const guard = {
      id: 'leave_it',
      type: 'CONDITIONAL',
      config: {
        condition: { variable: '{{steps.ask_it.output.resumeData.data.choice}}', operator: 'neq', value: '' },
        if_true: [{ id: 'left_it', type: 'GO_TO', config: { target: 'root', with: {
          screen: '{{steps.ask_it.output.resumeData.data.choice}}', text: '',
        } } }],
      },
    } as unknown as Step;

    const read = readQuestion(wait, guard, ctx);
    expect(read.asks.map((a) => a.name)).toEqual(['selectedOptions']);
    expect(read.choiceField).toBe('choice');
    expect(read.options.map((o) => o.label)).toEqual(['Main menu']);
  });
});

describe('answering it', () => {
  it('is asked on the way in, and read by a screen below for the rest of the visit', async () => {
    const config = asking('payments', WHICH_RIDE);
    const status = readConversationalFlow(config)!.screens.find((s) => s.id === 'payments_refund_status')!;
    const said = setPromptSays(config, status.prompts[0]!.id, [
      'Order {{steps.ask_payments_entry.output.resumeData.data.order_id}} — your refund is on its way.',
    ]);

    const { runtime } = harness();
    const id = await conversationOn(runtime, said, { orderId: 'A-1' });
    const answer = async (given: Parameters<typeof answerFor>[2]): Promise<ReturnType<typeof readTurn>> => {
      const run = await seen(runtime, id);
      const turn = readTurn(run);
      const { nodePath, payload } = answerFor(run, turn.turnId!, given);
      await runtime.resume(ANYONE, id, { data: payload as never, nodePath });
      return readTurn(await seen(runtime, id));
    };

    // Into Payments: what it asks for comes before the menu.
    const asked = await answer({ choice: 'payments' });
    expect(asked.messages.map((m) => m.text)).toEqual(['Which order is this about?']);
    expect(asked.reply?.fields?.map((f) => f.name)).toEqual(['order_id', 'shot']);

    const menu = await answer({ values: { order_id: 'A-7' } });
    expect(menu.messages.map((m) => m.text)).toEqual(['Payments — which part?']);

    await answer({ choice: 'payments_refunds' });
    const refund = await answer({ choice: 'payments_refund_status' });
    expect(refund.messages.map((m) => m.text)).toEqual(['Order A-7 — your refund is on its way.']);

    // What they gave is part of what happened, so it reaches whoever reads the
    // conversation — a transcript, a poll, the person who takes a hand off.
    const entries = readTranscript(await seen(runtime, id)).entries;
    expect(entries).toContainEqual({
      type: 'answered',
      fields: [{ name: 'order_id', label: 'Order number', value: 'A-7' }],
    });
  });

  it('reports a file by what it is, never by its handle', async () => {
    const config = asking('payments', {
      id: 'ask_payments_entry',
      type: 'WAIT',
      config: { mode: 'approval', reason: 'Payments', prompt: ['Anything to show us?'], form: { fields: [
        { type: 'attachment', name: 'shot', label: 'Screenshot' },
      ] } },
    });
    const { runtime } = harness();
    const id = await conversationOn(runtime, config, { orderId: 'A-1' });
    const step = async (given: Parameters<typeof answerFor>[2]): Promise<void> => {
      const run = await seen(runtime, id);
      const { nodePath, payload } = answerFor(run, readTurn(run).turnId!, given);
      await runtime.resume(ANYONE, id, { data: payload as never, nodePath });
    };

    await step({ choice: 'payments' });
    await step({ values: { shot: { name: 'receipt.png', mimeType: 'image/png', handle: 'secret-object-key' } } });

    const entries = readTranscript(await seen(runtime, id)).entries;
    expect(entries).toContainEqual({
      type: 'answered',
      fields: [{ name: 'shot', label: 'Screenshot', value: { name: 'receipt.png', mimeType: 'image/png' } }],
    });
    expect(JSON.stringify(entries)).not.toContain('secret-object-key');
  });
});
