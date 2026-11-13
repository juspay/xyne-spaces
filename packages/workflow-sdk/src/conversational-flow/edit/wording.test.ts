/**
 * The everyday edits: what a screen offers, what it says, and whether it takes
 * typing. Each one is read back through the projection, so a test passes only
 * if the config really says it — never because the editor agreed with itself.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { readConversationalFlow } from '../read.js';
import { refreshDerived } from '../settle.js';
import { answer, answering, conversationOn, harness, parked, restoreFetch } from '../testing.js';
import { optionsOf, type ConversationalFlow, type Screen } from '../types.js';
import { addCall, callRef } from './calls.js';
import { addOption, moveOption, removeOption, relabelOption, retargetOption, setWayBack } from './options.js';
import { setAbout, setPromptSays, setTypingAllowed } from './prompts.js';
import agentFlow from '../__fixtures__/support-tree.json';

const original = agentFlow as unknown as WorkflowConfig;
const support = () => original;
const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screenOf = (flow: ConversationalFlow, id: string): Screen => flow.screens.find((s) => s.id === id)!;
/** The question a screen asks — what an option edit names. */
const questionOn = (flow: ConversationalFlow, id: string): string => screenOf(flow, id).prompts[0]!.id;

const stillLegal = (config: WorkflowConfig) => {
  const validator = new ConfigValidator(new ConnectorRegistry());
  const said = (c: WorkflowConfig) => new Set(validator.validate(c).issues.map((i) => `${i.code}: ${i.message}`));
  expect([...said(config)].filter((issue) => !said(original).has(issue))).toEqual([]);
};

describe('the options a question offers', () => {
  it('adds one above the ways back, pointing where it says', () => {
    const config = addOption(support(), questionOn(read(support()), 'payments_refunds'), { label: 'End of chat', screen: 'done' });
    const options = optionsOf(screenOf(read(config), 'payments_refunds'));
    const added = options.findIndex((o) => o.label === 'End of chat');
    expect(options[added]!.to).toEqual({ kind: 'screen', screen: 'done' });
    // Above the first way back, which is where a new option reads first.
    expect(added).toBeLessThan(options.findIndex((o) => o.back));
    stillLegal(config);
  });

  it('renames, re-points, reorders and removes one', () => {
    const base = support();
    const flow = read(base);
    const before = optionsOf(screenOf(flow, 'payments_refunds'));

    expect(optionsOf(screenOf(read(relabelOption(base, questionOn(read(base), 'payments_refunds'), 0, 'Where is it')), 'payments_refunds'))[0]!.label).toBe('Where is it');
    expect(optionsOf(screenOf(read(retargetOption(base, questionOn(read(base), 'payments_refunds'), 0, 'rides')), 'payments_refunds'))[0]!.to).toEqual({
      kind: 'screen',
      screen: 'rides',
    });
    expect(optionsOf(screenOf(read(moveOption(base, questionOn(read(base), 'payments_refunds'), 0, 1)), 'payments_refunds'))[1]!.label).toBe(before[0]!.label);
    expect(optionsOf(screenOf(read(removeOption(base, questionOn(read(base), 'payments_refunds'), 0)), 'payments_refunds'))).toHaveLength(before.length - 1);
  });

  it('writes the ways back from where the screen sits', () => {
    const off = setWayBack(support(), 'payments_double_charge', false);
    expect(optionsOf(screenOf(read(off), 'payments_double_charge')).some((o) => o.back)).toBe(false);

    const on = setWayBack(off, 'payments_double_charge', true);
    expect(optionsOf(screenOf(read(on), 'payments_double_charge')).filter((o) => o.back).map((o) => o.label)).toEqual([
      '↑ Ride charges',
      '↑ Charges',
      '↑ Payments',
      'Main menu',
    ]);
    stillLegal(on);
  });

  it('refuses what it cannot mean', () => {
    expect(() => addOption(support(), questionOn(read(support()), 'payments_refunds'), { label: ' ', screen: 'rides' })).toThrow(/needs a label/);
    expect(() => addOption(support(), questionOn(read(support()), 'payments_refunds'), { label: 'x', screen: 'nowhere' })).toThrow(/no screen/);
    expect(() => removeOption(support(), questionOn(read(support()), 'payments_refunds'), 99)).toThrow(/No such option/);
  });
});

describe('what a screen says', () => {
  it('sets the wording, and it may quote what a frame fetched', () => {
    const { config: withCall } = addCall(support(), 'payments', {
      title: 'Refund',
      request: { method: 'GET', url: 'https://93.184.216.34/refunds/{{trigger.context.orderId}}', timeoutMs: 2_000 },
    });
    const flow = read(withCall);
    const prompt = screenOf(flow, 'payments_refund_status').prompts[0]!;
    const config = setPromptSays(withCall, prompt.id, [`It is ${callRef('refund', 'body.status')}.`]);
    expect(screenOf(read(config), 'payments_refund_status').prompts[0]!.says[0]).toBe('It is {{steps.refund.output.body.status}}.');
    stillLegal(config);
  });

  it('says when the router should send people here', () => {
    const config = setAbout(support(), 'payments_refund_status', 'where a refund has reached');
    expect(screenOf(read(config), 'payments_refund_status').about).toBe('where a refund has reached');
    expect(screenOf(read(setAbout(config, 'payments_refund_status', '')), 'payments_refund_status').about).toBeUndefined();
  });
});

describe('whether a screen takes typing', () => {
  it('takes the text field and the branch away, and puts them back', () => {
    const before = read(support());
    expect(screenOf(before, 'payments_refunds').prompts[0]!.textField).toBe('message');

    const off = setTypingAllowed(support(), 'payments_refunds', false);
    const quiet = screenOf(read(off), 'payments_refunds');
    expect(quiet.prompts[0]!.textField).toBeUndefined();
    expect(quiet.prompts[0]!.freeText).toBeUndefined();
    // Tapping is untouched: the options still lead where they led.
    expect(optionsOf(quiet).map((o) => [o.label, o.to])).toEqual(
      optionsOf(screenOf(before, 'payments_refunds')).map((o) => [o.label, o.to]),
    );
    stillLegal(off);

    const on = setTypingAllowed(off, 'payments_refunds', true);
    const back = screenOf(read(on), 'payments_refunds');
    expect(back.prompts[0]!.textField).toBe('message');
    expect(back.prompts[0]!.freeText).toEqual({ kind: 'screen', screen: 'classify' });
    expect(optionsOf(back).map((o) => [o.label, o.to])).toEqual(optionsOf(quiet).map((o) => [o.label, o.to]));
    stillLegal(on);
  });

  it('is left alone when it is already what was asked for', () => {
    const config = support();
    expect(setTypingAllowed(config, 'payments_refunds', true)).toBe(config);
  });
});

describe('a screen edited while a section fetches', () => {
  it('still reads what the section found, after the wording changed', async () => {
    const { config: withCall } = addCall(support(), 'payments', {
      title: 'Refund',
      request: { method: 'GET', url: 'https://93.184.216.34/refunds/{{trigger.context.orderId}}', timeoutMs: 2_000 },
    });
    const prompt = screenOf(read(withCall), 'payments_refunds').prompts[0]!;
    const config = setTypingAllowed(
      setPromptSays(withCall, prompt.id, [`Refunds. It is ${callRef('refund', 'body.status')}.`]),
      'payments_refunds',
      false,
    );

    const { runtime } = harness();
    const service = answering({ status: 'on its way' });
    const id = await conversationOn(runtime, config, { orderId: 'A-1' });
    await parked(runtime, id);
    await answer(runtime, id, 'payments');
    expect((await answer(runtime, id, 'payments_refunds')).prompt).toBe('Refunds. It is on its way.');
    expect(service.calls).toBe(1);
  });
});

/**
 * "Offer the way back" is a switch on a screen, and a screen may ask with more
 * than one question — every one of which carries the ways back.
 */
describe('offering the way back, as a screen setting', () => {
  const backs = (config: WorkflowConfig, screenId: string): number[] =>
    read(config).screens.find((s) => s.id === screenId)!.prompts.map((p) => p.options.filter((o) => o.back).length);

  it('turns them off on every question the screen asks', () => {
    const screenId = 'payments_double_charge';
    expect(backs(support(), screenId).every((n) => n > 0)).toBe(true);

    const off = setWayBack(support(), screenId, false);
    expect(backs(off, screenId).every((n) => n === 0)).toBe(true);

    const on = setWayBack(off, screenId, true);
    expect(backs(on, screenId).every((n) => n > 0)).toBe(true);
  });

  it('takes the screen id — the only id an author has in hand', () => {
    // The crash this replaced: the screen's id handed to a question-level
    // setter, which looked for a question by that name and found none. There is
    // now one function, and it takes the id the editor actually holds.
    expect(() => setWayBack(support(), 'payments_double_charge', false)).not.toThrow();
    expect(() => setWayBack(support(), 'no_such_screen', false)).toThrow(/no screen/);
  });

  it('still refuses the first screen, which has nowhere to go back to', () => {
    expect(() => setWayBack(support(), read(support()).rootScreen, true)).toThrow(/nowhere to go back/);
  });
});
