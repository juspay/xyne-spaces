/**
 * A screen whose purpose is to ask.
 *
 * Its question sits before its frame, so the screen inside reads the answers
 * without anything carrying them — and answering is how they go on, so the only
 * thing it offers is not answering.
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import { readConversationalFlow } from '../read.js';
import { answerRef } from '../questions.js';
import { answerFor, readTranscript, readTurn } from '../turn.js';
import { conversationOn, harness, seen } from '../testing.js';
import { addInputScreen, setQuestion, setQuestionPurpose, setQuestionSays } from './questions.js';
import { addScreen, renameScreen } from './screens.js';
import { addVersion } from './versions.js';
import { setPromptSays } from './prompts.js';
import { setScreenType, whatChangingTypeCosts } from './kinds.js';
import type { QuestionDraft, Screen } from '../types.js';
import support from '../__fixtures__/support-tree.json';

const BASE = support as unknown as WorkflowConfig;

// What an author writes is the kind and the label; the key follows the kind.
const ORDER: QuestionDraft = { kind: 'text', label: 'Order number', required: true };
const SHOT: QuestionDraft = { kind: 'attachment', label: 'Add a screenshot' };
const PICK: QuestionDraft = { kind: 'choice', label: 'What went wrong?', choices: ['Driver', 'Route'] };

/** One inside Payments, which is the only kind of screen that asks. */
function asking(asks: readonly QuestionDraft[] = [], next?: { title: string }) {
  return addInputScreen(BASE, { parent: 'payments', title: 'Tell us more', ...(asks.length > 0 ? { asks } : {}), ...(next ? { next } : {}) });
}

function screenOf(config: WorkflowConfig, id: string): Screen {
  return readConversationalFlow(config)!.screens.find((s) => s.id === id)!;
}

/** The fixture quotes an agent this registry has never heard of, so compare. */
function issuesIn(config: WorkflowConfig): unknown[] {
  return new ConfigValidator(new ConnectorRegistry()).validate(config).issues;
}

function stillLegal(config: WorkflowConfig): void {
  expect(issuesIn(config)).toEqual(issuesIn(BASE));
}

describe('what it asks for', () => {
  it('is written before the frame, and reads back as what was asked for', () => {
    const { config, screenId } = asking([ORDER, SHOT]);
    const question = screenOf(config, screenId).questions[0]!;
    expect(question.asks).toEqual([
      { kind: 'text', name: 'textInput', label: 'Order number', required: true, choices: [], multiple: false },
      { kind: 'attachment', name: 'attachments', label: 'Add a screenshot', required: false, choices: [], multiple: false },
    ]);
    // The same shape a lookup's fields take, because the picker offers both alike.
    expect(question.answers).toEqual([{ path: 'textInput', type: 'string' }, { path: 'attachments', type: 'object' }]);
    stillLegal(config);
  });

  it('offers not answering, and nothing else — answering is the way on', () => {
    const { config, screenId } = asking([ORDER]);
    expect(screenOf(config, screenId).questions[0]!.options).toEqual([
      { label: '↑ Payments', value: 'payments', to: { kind: 'screen', screen: 'payments' }, back: true },
      { label: 'Main menu', value: 'root', to: { kind: 'screen', screen: 'root' }, back: true },
    ]);
    expect(screenOf(config, screenId).questions[0]!.asks.map((a) => a.name)).toEqual(['textInput']);
  });

  it('is left with nothing to fill in, not with no question at all', () => {
    const { config, screenId } = asking([ORDER, SHOT]);
    const none = setQuestion(config, screenId, []);
    expect(screenOf(none, screenId).questions[0]!.asks).toEqual([]);
    expect(screenOf(none, screenId).questions[0]!.options.map((o) => o.back)).toEqual([true, true]);
    expect(screenOf(none, screenId).kind).toBe('input');
  });

  it('says several things, and takes one back', () => {
    const { config, screenId } = asking([ORDER]);
    // A new box is empty until it is typed in, so it has to survive being added.
    const two = setQuestionSays(config, screenId, ['Which order is this about?', '']);
    expect(screenOf(two, screenId).questions[0]!.says).toEqual(['Which order is this about?', '']);

    const said = setQuestionSays(two, screenId, ['Which order is this about?', 'Anything else helps.']);
    expect(screenOf(said, screenId).questions[0]!.says).toEqual([
      'Which order is this about?', 'Anything else helps.',
    ]);

    const one = setQuestionSays(said, screenId, ['Which order is this about?']);
    expect(screenOf(one, screenId).questions[0]!.says).toEqual(['Which order is this about?']);
  });

  it('keeps what it says while the fields change', () => {
    const { config, screenId } = asking([ORDER]);
    const said = setQuestionSays(config, screenId, ['Which order is this about?']);
    const changed = setQuestion(said, screenId, [ORDER, SHOT]);
    expect(screenOf(changed, screenId).questions[0]!.says).toEqual(['Which order is this about?']);
    expect(screenOf(changed, screenId).questions[0]!.asks).toHaveLength(2);
  });

  it('relabels its way out when the screen it leads to is renamed', () => {
    const { config, screenId } = asking([ORDER]);
    const renamed = renameScreen(config, 'payments', 'Billing');
    expect(screenOf(renamed, screenId).questions[0]!.options.map((o) => o.label)).toEqual(['↑ Billing', 'Main menu']);
  });

  it('is not copied onto the next screen somebody adds', () => {
    const { config } = asking([ORDER]);
    const { config: grown, screenId } = addScreen(config, { title: 'Late fee', parent: 'payments' });
    expect(screenOf(grown, screenId).prompts[0]?.choiceField).toBe('choice');
    expect(screenOf(grown, screenId).prompts[0]!.textField).toBe('message');
    expect(screenOf(grown, screenId).questions).toEqual([]);
    stillLegal(grown);
  });
});

describe('the screen itself', () => {
  it('is its own kind, with one screen inside it and nothing of its own to ask', () => {
    const { config, screenId, nextId } = asking([ORDER], { title: 'Looking into it' });
    const node = screenOf(config, screenId);
    expect(node.kind).toBe('input');
    expect(node.children).toEqual([nextId]);
    expect(node.prompts).toEqual([]);
    stillLegal(config);
  });

  it('is not somewhere the screen inside it can go back to', () => {
    const { config, screenId, nextId } = asking([ORDER]);
    const back = screenOf(config, nextId).prompts[0]!.options.filter((o) => o.back).map((o) => o.value);
    expect(back).not.toContain(screenId);
    expect(back).toEqual(['payments', 'root']);
  });

  it('is added rather than converted, and holds one screen', () => {
    const { config, screenId } = asking([ORDER]);
    expect(() => setScreenType(config, screenId, 'message')).toThrow(/added rather than converted/);
    expect(() => addScreen(config, { title: 'Another', parent: screenId })).toThrow(/the one screen inside it/);
  });

  it('says what a conversion would cost before the room goes', () => {
    const { config, screenId } = asking([ORDER]);
    expect(whatChangingTypeCosts(readConversationalFlow(config)!, screenId, 'message')).toContain('what it asks on the way in');
  });
});

describe('answering it', () => {
  it('asks once, then the screen inside opens with the answer', async () => {
    const made = asking([ORDER], { title: 'Looking into it' });
    const said = setQuestionSays(made.config, made.screenId, ['Which order is this about?']);
    const inside = screenOf(said, made.nextId);
    const config = setPromptSays(said, inside.prompts[0]!.id, [
      `Order ${answerRef(screenOf(said, made.screenId).questions[0]!.id, 'textInput')} — we’re looking into it.`,
    ]);

    const { runtime } = harness();
    const id = await conversationOn(runtime, config, { orderId: 'A-1' });
    const answer = async (given: Parameters<typeof answerFor>[2]): Promise<ReturnType<typeof readTurn>> => {
      const run = await seen(runtime, id);
      const turn = readTurn(run);
      const { nodePath, payload } = answerFor(run, turn.turnId!, given);
      await runtime.resume({} as never, id, { data: payload as never, nodePath });
      return readTurn(await seen(runtime, id));
    };

    await answer({ choice: 'payments' });
    const open = await answer({ choice: made.screenId });
    // One message: what it says, what it asks for, and the ways out. No button
    // to go on — answering is going on.
    expect(open.messages.map((m) => m.text)).toEqual(['Which order is this about?']);
    expect(open.reply?.fields?.map((f) => f.name)).toEqual(['textInput']);
    expect(open.reply?.options.map((o) => ({ label: o.label, kind: o.kind }))).toEqual([
      { label: '↑ Payments', kind: 'back' },
      { label: 'Main menu', kind: 'back' },
    ]);

    const next = await answer({ values: { textInput: 'A-7' } });
    expect(next.messages.map((m) => m.text)).toEqual(['Order A-7 — we’re looking into it.']);

    // What they gave is part of what happened, so it reaches whoever reads it.
    expect(readTranscript(await seen(runtime, id)).entries).toContainEqual({
      type: 'answered',
      fields: [{ name: 'textInput', label: 'Order number', value: 'A-7' }],
    });
  });

  it('refuses to go on without what the author made required', async () => {
    // The form's own schema carries no `required`, so this is what keeps the
    // promise the editor makes — and what stops the screen inside reading ''.
    const made = asking([ORDER]);
    const { runtime } = harness();
    const id = await conversationOn(runtime, made.config, {});
    const step = async (given: Parameters<typeof answerFor>[2]): Promise<void> => {
      const run = await seen(runtime, id);
      const { nodePath, payload } = answerFor(run, readTurn(run).turnId!, given);
      await runtime.resume({} as never, id, { data: payload as never, nodePath });
    };

    await step({ choice: 'payments' });
    await step({ choice: made.screenId });
    const run = await seen(runtime, id);
    expect(() => answerFor(run, readTurn(run).turnId!, { values: { textInput: '' } }))
      .toThrow(/“Order number” is needed to go on/);
  });

  it('lets them leave instead, without answering what is required', async () => {
    const made = asking([ORDER]);
    const { runtime } = harness();
    const id = await conversationOn(runtime, made.config, {});
    const answer = async (given: Parameters<typeof answerFor>[2]): Promise<ReturnType<typeof readTurn>> => {
      const run = await seen(runtime, id);
      const turn = readTurn(run);
      const { nodePath, payload } = answerFor(run, turn.turnId!, given);
      await runtime.resume({} as never, id, { data: payload as never, nodePath });
      return readTurn(await seen(runtime, id));
    };

    await answer({ choice: 'payments' });
    await answer({ choice: made.screenId });
    const left = await answer({ choice: 'root' });
    expect(left.screen?.id).toBe('root');
  });
});

describe('what the answers are for', () => {
  it('is on the turn that asks, so a client can draw it before there is an answer', async () => {
    // The field names are the same in every workflow: without this, a rating
    // worth drawing as stars is indistinguishable from a pick of reasons until
    // it has already been answered, which is too late to have drawn it.
    const made = addInputScreen(BASE, {
      parent: 'payments',
      title: 'How did we do?',
      purpose: 'feedback',
      asks: [{ kind: 'choice', label: 'How did we do?', choices: ['1', '5'] }],
      next: { title: 'Thanks' },
    });
    const { runtime } = harness();
    const id = await conversationOn(runtime, made.config, {});
    const go = async (given: Parameters<typeof answerFor>[2]): Promise<void> => {
      const run = await seen(runtime, id);
      const { nodePath, payload } = answerFor(run, readTurn(run).turnId!, given);
      await runtime.resume({} as never, id, { data: payload as never, nodePath });
    };

    await go({ choice: 'payments' });
    await go({ choice: made.screenId });

    const asked = readTurn(await seen(runtime, id));
    expect(asked.reply?.purpose).toBe('feedback');
    // Beside the fields it describes, the same pair the answer comes back as.
    expect(asked.reply?.fields?.map((f) => f.name)).toEqual(['selectedOptions']);
  });

  it('is not on a turn whose author set none', async () => {
    const made = addInputScreen(BASE, {
      parent: 'payments',
      title: 'Tell us more',
      asks: [{ kind: 'choice', label: 'Which ride?', choices: ['a', 'b'] }],
      next: { title: 'Thanks' },
    });
    const { runtime } = harness();
    const id = await conversationOn(runtime, made.config, {});
    const go = async (given: Parameters<typeof answerFor>[2]): Promise<void> => {
      const run = await seen(runtime, id);
      const { nodePath, payload } = answerFor(run, readTurn(run).turnId!, given);
      await runtime.resume({} as never, id, { data: payload as never, nodePath });
    };
    await go({ choice: 'payments' });
    await go({ choice: made.screenId });
    expect(readTurn(await seen(runtime, id)).reply?.purpose).toBeUndefined();
  });

  it('is carried to whoever reads the run, beside what they gave', async () => {
    const made = addInputScreen(BASE, {
      parent: 'payments',
      title: 'How did we do?',
      purpose: 'feedback',
      asks: [{ kind: 'choice', label: 'How did we do?', choices: ['1', '5'] }],
      next: { title: 'Thanks' },
    });
    expect(screenOf(made.config, made.screenId).questions[0]!.purpose).toBe('feedback');

    const { runtime } = harness();
    const id = await conversationOn(runtime, made.config, {});
    const answer = async (given: Parameters<typeof answerFor>[2]): Promise<void> => {
      const run = await seen(runtime, id);
      const { nodePath, payload } = answerFor(run, readTurn(run).turnId!, given);
      await runtime.resume({} as never, id, { data: payload as never, nodePath });
    };

    await answer({ choice: 'payments' });
    await answer({ choice: made.screenId });
    await answer({ values: { selectedOptions: '5' } });

    expect(readTranscript(await seen(runtime, id)).entries).toContainEqual({
      type: 'answered',
      purpose: 'feedback',
      fields: [{ name: 'selectedOptions', label: 'How did we do?', value: '5' }],
    });
  });

  it('survives an edit to the fields, and comes off when it is taken off', () => {
    const made = addInputScreen(BASE, { parent: 'payments', title: 'How did we do?', purpose: 'feedback', asks: [ORDER] });
    const more = setQuestion(made.config, made.screenId, [ORDER, SHOT]);
    expect(screenOf(more, made.screenId).questions[0]!.purpose).toBe('feedback');

    const none = setQuestionPurpose(more, made.screenId, '');
    expect(screenOf(none, made.screenId).questions[0]!.purpose).toBeUndefined();
  });
});

describe('asking it differently', () => {
  it('is refused, and says where it belongs instead', () => {
    const { config, screenId } = asking([ORDER]);
    // Two ways would be two WAITs with two ids, and the screen inside can only
    // name one of them — so what it opened would read an empty answer.
    expect(() => addVersion(config, screenId, { variable: '{{trigger.context.orderId}}', operator: 'eq', value: 'A-1' }))
      .toThrow(/asks one way/);
  });
});

describe('what it refuses', () => {
  it('refuses the same parents every other screen refuses', () => {
    const { config, screenId } = asking([ORDER]);
    // One rule, so the map, the inspector and every edit agree.
    expect(() => addInputScreen(config, { parent: screenId, title: 'Again' })).toThrow(/the one screen inside it/);
    expect(() => addInputScreen(config, { parent: 'done', title: 'After the end' })).toThrow(/ends the conversation/);
    expect(() => addInputScreen(config, { parent: 'classify', title: 'In the router' })).toThrow(/nothing sits inside it/);
  });

  it('refuses any screen that is not one for asking', () => {
    expect(() => setQuestion(BASE, 'root', [ORDER])).toThrow(/isn’t a screen that asks/);
    expect(() => setQuestion(BASE, 'payments', [ORDER])).toThrow(/isn’t a screen that asks/);
    expect(() => setQuestion(BASE, 'payments_refund_status', [ORDER])).toThrow(/isn’t a screen that asks/);
  });

  it('refuses two of a kind, since the key is the kind', () => {
    const { config, screenId } = asking();
    expect(() => setQuestion(config, screenId, [ORDER, { ...ORDER, label: 'And anything else' }])).toThrow(/asks for one of each/);
    // All three at once is the point, though.
    const all = setQuestion(config, screenId, [ORDER, PICK, SHOT]);
    expect(screenOf(all, screenId).questions[0]!.asks.map((a) => a.name)).toEqual([
      'textInput', 'selectedOptions', 'attachments',
    ]);
    expect(screenOf(all, screenId).questions[0]!.asks[1]!.choices).toEqual(['Driver', 'Route']);
    stillLegal(all);
  });
});
