/**
 * The pieces built for conditional conversations, run together as conversations.
 *
 * Each case starts a real conversation on a real runtime, with the lookup's
 * answer stubbed, and asks the one question that matters: **what was this person
 * actually offered?** Nothing here inspects the config — the config is already
 * covered where it is written. This is about what comes out the other end.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigValidator } from '../engine/config-validator.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { Condition, WorkflowConfig } from '../types/workflow-config.js';
import { createConversationalFlow } from './create.js';
import { readConversationalFlow } from './read.js';
import { answer, answering, conversationOn, harness, restoreFetch, seen } from './testing.js';
import { readTurn } from './turn.js';
import type { ConversationalFlow } from './types.js';
import { addCall } from './edit/calls.js';
import { addOption, setOptionCondition } from './edit/options.js';
import { setConversationInputs } from './edit/inputs.js';
import { setPromptSays } from './edit/prompts.js';
import { addScreen } from './edit/screens.js';
import { addVersion } from './edit/versions.js';

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const promptOf = (config: WorkflowConfig, screen: string) => read(config).screens.find((s) => s.id === screen)!.prompts[0]!;
const issues = (config: WorkflowConfig) => new ConfigValidator(new ConnectorRegistry()).validate(config).issues;

/** Put a condition on the option with this label, wherever it ended up. */
function onlyWhen(config: WorkflowConfig, screen: string, label: string, when: Condition): WorkflowConfig {
  const prompt = promptOf(config, screen);
  const at = prompt.options.findIndex((o) => o.label === label);
  if (at === -1) throw new Error(`no option “${label}” on ${screen}`);
  return setOptionCondition(config, prompt.id, at, when);
}

/** Start a conversation and say what the person was offered. */
async function offered(config: WorkflowConfig, body: unknown, context: Record<string, unknown> = {}): Promise<string[]> {
  answering(body);
  const { runtime } = harness();
  const id = await conversationOn(runtime, config, context);
  const turn = readTurn(await seen(runtime, id));
  return turn.reply?.options.map((o) => o.label) ?? [];
}

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

// ─── What everything is built on ───

/**
 * A support flow that looks the account up on the way in — before the first
 * screen, so every screen below can read it — and has somewhere to send people.
 */
function support(): { config: WorkflowConfig; account: string } {
  const { config: made } = createConversationalFlow({ title: 'Support' });
  const { config: grown } = addScreen(made, { title: 'Done', parent: 'start' });
  const { config, callId } = addCall(grown, 'start', {
    title: 'Account',
    request: {
      method: 'GET',
      url: 'https://93.184.216.34/account',
      response: {
        type: 'json',
        bodySchema: {
          type: 'object',
          properties: {
            plan: { type: 'string' },
            owed: { type: 'number' },
            note: { type: 'string' },
            city: { type: 'string' },
            // Declared, and left out of some answers: that is what "is missing"
            // is for. A field the lookup never declared is a reference the
            // validator refuses — see the case below.
            cancelledAt: { type: 'string' },
          },
        },
      },
    },
  });
  return { config, account: callId };
}

const at = (call: string, field: string) => `{{steps.${call}.output.body.${field}}}`;

describe('a lookup on the way in, and options that read it', () => {
  it('offers every operator the engine has, and only where it holds', async () => {
    const { config: base, account } = support();

    // One screen, one fetch, thirteen operators — the set of labels that comes
    // back is the whole assertion.
    const tests: Array<[label: string, when: Condition, kept: boolean]> = [
      ['eq',           { variable: at(account, 'plan'), operator: 'eq', value: 'priority' }, true],
      ['eq no',        { variable: at(account, 'plan'), operator: 'eq', value: 'gold' }, false],
      ['neq',          { variable: at(account, 'plan'), operator: 'neq', value: 'standard' }, true],
      ['contains',     { variable: at(account, 'city'), operator: 'contains', value: 'eng' }, true],
      ['not_contains', { variable: at(account, 'city'), operator: 'not_contains', value: 'xyz' }, true],
      ['starts_with',  { variable: at(account, 'city'), operator: 'starts_with', value: 'Beng' }, true],
      ['ends_with',    { variable: at(account, 'city'), operator: 'ends_with', value: 'uru' }, true],
      ['gt',           { variable: at(account, 'owed'), operator: 'gt', value: 100 }, true],
      ['gt no',        { variable: at(account, 'owed'), operator: 'gt', value: 900 }, false],
      ['gte',          { variable: at(account, 'owed'), operator: 'gte', value: 250 }, true],
      ['lt',           { variable: at(account, 'owed'), operator: 'lt', value: 100 }, false],
      ['lte',          { variable: at(account, 'owed'), operator: 'lte', value: 250 }, true],
      ['exists',       { variable: at(account, 'plan'), operator: 'exists' }, true],
      ['not_exists',   { variable: at(account, 'cancelledAt'), operator: 'not_exists' }, true],
      ['is_empty',     { variable: at(account, 'note'), operator: 'is_empty' }, true],
      ['is_empty no',  { variable: at(account, 'city'), operator: 'is_empty' }, false],
    ];

    let config = base;
    const prompt = promptOf(config, 'start').id;
    for (const [label] of tests) config = addOption(config, prompt, { label, screen: 'done' });
    for (const [label, when] of tests) config = onlyWhen(config, 'start', label, when);
    expect(issues(config)).toEqual([]);

    const shown = await offered(config, { plan: 'priority', owed: 250, note: '', city: 'Bengaluru' });
    expect(shown.filter((l) => tests.some(([t]) => t === l)).sort()).toEqual(
      tests.filter(([, , kept]) => kept).map(([label]) => label).sort(),
    );
  });

  it('offers an option by something worked out, not just read', async () => {
    // Conditions used to compare a reference against a literal and nothing
    // else. Both halves now take an expression, which is what lets a screen
    // branch on a total rather than on a single field.
    const { config: base, account } = support();
    const prompt = promptOf(base, 'start').id;
    const path = (field: string) => `steps.${account}.output.body.${field}`;

    const tests: Array<[string, Condition, boolean]> = [
      ['total',     { variable: `{% $sum([${path('owed')}, 50]) %}`, operator: 'gt', value: 200 }, true],
      ['total no',  { variable: `{% $sum([${path('owed')}, 50]) %}`, operator: 'gt', value: 400 }, false],
      ['shouty',    { variable: `{% $uppercase(${path('city')}) %}`, operator: 'eq', value: 'BENGALURU' }, true],
      ['no note',   { variable: `{% $length(${path('note')}) %}`, operator: 'eq', value: 0 }, true],
      // And on the comparison side, which used to be compared literally.
      ['computed',  { variable: at(account, 'owed'), operator: 'eq', value: '{% 125 * 2 %}' }, true],
      ['computed no', { variable: at(account, 'owed'), operator: 'eq', value: '{% 125 * 3 %}' }, false],
    ];

    let config = base;
    for (const [label] of tests) config = addOption(config, prompt, { label, screen: 'done' });
    for (const [label, when] of tests) config = onlyWhen(config, 'start', label, when);
    expect(issues(config)).toEqual([]);

    const shown = await offered(config, { plan: 'priority', owed: 250, note: '', city: 'Bengaluru' });
    expect(shown.filter((l) => tests.some(([t]) => t === l)).sort()).toEqual(
      tests.filter(([, , kept]) => kept).map(([label]) => label).sort(),
    );
  });

  it('refuses an expression a condition could never run', () => {
    const { config: base, account } = support();
    const prompt = promptOf(base, 'start').id;
    const config = onlyWhen(addOption(base, prompt, { label: 'Refund', screen: 'done' }), 'start', 'Refund', {
      variable: `{% $sum([steps.${account}.output.body.nope]) %}`,
      operator: 'gt',
      value: 1,
    });
    // Checked inside the expression, exactly as a bare reference would be.
    const said = issues(config);
    expect(said.map((i) => i.code)).toEqual(['unknownReference']);
    expect(said[0]!.message).toContain('nope');
  });

  it('refuses a condition on a field the lookup never promised', () => {
    const { config: base, account } = support();
    const prompt = promptOf(base, 'start').id;
    const config = onlyWhen(addOption(base, prompt, { label: 'Refund', screen: 'done' }), 'start', 'Refund', {
      variable: at(account, 'nope'),
      operator: 'exists',
    });
    const said = issues(config);
    expect(said.map((i) => i.code)).toEqual(['unknownReference']);
    expect(said[0]!.message).toContain('body.nope');
  });

  it('reads a group: all of them, or any of them', async () => {
    const { config: base, account } = support();
    const prompt = promptOf(base, 'start').id;
    let config = base;
    for (const label of ['all', 'any']) config = addOption(config, prompt, { label, screen: 'done' });
    config = onlyWhen(config, 'start', 'all', {
      all: [
        { variable: at(account, 'plan'), operator: 'eq', value: 'priority' },
        { variable: at(account, 'owed'), operator: 'gt', value: 100 },
      ],
    });
    config = onlyWhen(config, 'start', 'any', {
      any: [
        { variable: at(account, 'plan'), operator: 'eq', value: 'gold' },
        { variable: at(account, 'owed'), operator: 'gt', value: 100 },
      ],
    });
    expect(issues(config)).toEqual([]);

    // Both hold.
    expect(await offered(config, { plan: 'priority', owed: 250 })).toEqual(expect.arrayContaining(['all', 'any']));
    restoreFetch();
    // `all` needs both; `any` still has the second.
    const half = await offered(config, { plan: 'standard', owed: 250 });
    expect(half).toContain('any');
    expect(half).not.toContain('all');
    restoreFetch();
    // Neither.
    const none = await offered(config, { plan: 'standard', owed: 5 });
    expect(none).not.toContain('any');
    expect(none).not.toContain('all');
  });

  it('mixes what it was started with and what it looked up, in one condition', async () => {
    const { config: base, account } = support();
    const withInputs = setConversationInputs(base, [{ path: 'tier' }]);
    const prompt = promptOf(withInputs, 'start').id;
    const config = onlyWhen(
      addOption(withInputs, prompt, { label: 'Escalate', screen: 'done' }),
      'start',
      'Escalate',
      {
        all: [
          { variable: '{{trigger.context.tier}}', operator: 'eq', value: 'gold' },
          { variable: at(account, 'owed'), operator: 'gt', value: 100 },
        ],
      },
    );
    expect(issues(config)).toEqual([]);

    expect(await offered(config, { owed: 250 }, { tier: 'gold' })).toContain('Escalate');
    restoreFetch();
    // The lookup says yes, the caller says no.
    expect(await offered(config, { owed: 250 }, { tier: 'free' })).not.toContain('Escalate');
    restoreFetch();
    // Started with nothing at all: the condition fails closed.
    expect(await offered(config, { owed: 250 })).not.toContain('Escalate');
  });

  it('is in scope two levels down, fetched once for the whole conversation', async () => {
    const { config: base, account } = support();
    const { config: mid } = addScreen(base, { title: 'Payments', parent: 'start', type: 'menu' });
    const { config: deep } = addScreen(mid, { title: 'Refunds', parent: 'payments' });
    const prompt = promptOf(deep, 'refunds').id;
    const config = onlyWhen(
      addOption(deep, prompt, { label: 'Refund it now', screen: 'done' }),
      'refunds',
      'Refund it now',
      { variable: at(account, 'plan'), operator: 'eq', value: 'priority' },
    );
    expect(issues(config)).toEqual([]);

    for (const [plan, expected] of [['priority', true], ['standard', false]] as const) {
      const service = answering({ plan });
      const { runtime } = harness();
      const id = await conversationOn(runtime, config, {});
      await answer(runtime, id, 'payments');
      await answer(runtime, id, 'refunds');
      const turn = readTurn(await seen(runtime, id));
      const labels = turn.reply?.options.map((o) => o.label) ?? [];
      expect(labels.includes('Refund it now')).toBe(expected);
      // Once on the way in — not again per screen, however deep they went.
      expect(service.calls).toBe(1);
      restoreFetch();
    }
  });
});

describe('a screen asked differently, and an option inside it', () => {
  it('runs the version the data picks, and filters that version’s own options', async () => {
    const { config: base, account } = support();
    const { config: two, promptId } = addVersion(base, 'start', {
      variable: at(account, 'plan'),
      operator: 'eq',
      value: 'priority',
    });
    // The priority way of asking says something else, and offers one more line.
    const said = setPromptSays(two, promptId, ['You’re on priority — how can I help?']);
    const withOption = addOption(said, promptId, { label: 'Talk to your manager', screen: 'done' });
    const prompt = read(withOption).screens.find((s) => s.id === 'start')!.prompts.find((p) => p.id === promptId)!;
    const at_ = prompt.options.findIndex((o) => o.label === 'Talk to your manager');
    const config = setOptionCondition(withOption, promptId, at_, {
      variable: at(account, 'owed'),
      operator: 'gt',
      value: 100,
    });
    expect(issues(config)).toEqual([]);

    // Priority and owing: the other wording, with the extra line.
    answering({ plan: 'priority', owed: 250 });
    let { runtime } = harness();
    let id = await conversationOn(runtime, config, {});
    let turn = readTurn(await seen(runtime, id));
    expect(turn.messages.at(-1)?.text).toBe('You’re on priority — how can I help?');
    expect(turn.reply?.options.map((o) => o.label)).toContain('Talk to your manager');
    restoreFetch();

    // Priority but owing nothing: same wording, the line filtered out of it.
    answering({ plan: 'priority', owed: 0 });
    ({ runtime } = harness());
    id = await conversationOn(runtime, config, {});
    turn = readTurn(await seen(runtime, id));
    expect(turn.messages.at(-1)?.text).toBe('You’re on priority — how can I help?');
    expect(turn.reply?.options.map((o) => o.label)).not.toContain('Talk to your manager');
    restoreFetch();

    // Standard: the way it is asked when nothing else holds, which never had it.
    answering({ plan: 'standard', owed: 250 });
    ({ runtime } = harness());
    id = await conversationOn(runtime, config, {});
    turn = readTurn(await seen(runtime, id));
    expect(turn.messages.at(-1)?.text).not.toBe('You’re on priority — how can I help?');
    expect(turn.reply?.options.map((o) => o.label)).not.toContain('Talk to your manager');
  });
});
