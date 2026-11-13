/**
 * Editing the tree.
 *
 * Two things are worth watching: a leaf becoming a section when it gets its
 * first child (and back again when it loses its last), and a move leaving the
 * config true — the subtrees each section claims, the jumps, the headings.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray, asRec } from '../json.js';
import { caseFor, sectionCaseFor } from '../locate.js';
import { readConversationalFlow } from '../read.js';
import { refreshDerived } from '../settle.js';
import { caseKind, partsOf } from '../shape.js';
import { answer, answering, conversationOn, harness, parked, restoreFetch } from '../testing.js';
import { optionsOf, type ConversationalFlow, type Screen } from '../types.js';
import { ancestorsOf, subtreeOf } from '../tree.js';
import { addCall, callRef } from './calls.js';
import { setScreenType } from './kinds.js';
import { relabelOption, setWayBack } from './options.js';
import { addScreen, emptyScreen, moveIsValid, moveScreen, removeScreen, renameScreen } from './screens.js';
import agentFlow from '../__fixtures__/support-tree.json';

const original = agentFlow as unknown as WorkflowConfig;
const support = () => original;

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screenOf = (flow: ConversationalFlow, id: string): Screen => flow.screens.find((s) => s.id === id)!;
/** The screens a screen offers to go back to, in the order it offers them. */
const backsOf = (flow: ConversationalFlow, id: string): string[] =>
  optionsOf(screenOf(flow, id))
    .filter((o) => o.back)
    .map((o) => (o.to.kind === 'screen' ? o.to.screen : '?'));

function claims(config: WorkflowConfig, flow: ConversationalFlow, id: string): string[] {
  const entry = sectionCaseFor(config, flow, screenOf(flow, id));
  const kind = entry ? caseKind(entry, flow.routeKey) : null;
  return kind?.kind === 'section' ? kind.subtree : [];
}

const stillLegal = (config: WorkflowConfig) => {
  const validator = new ConfigValidator(new ConnectorRegistry());
  const said = (c: WorkflowConfig) => new Set(validator.validate(c).issues.map((i) => `${i.code}: ${i.message}`));
  expect([...said(config)].filter((issue) => !said(original).has(issue))).toEqual([]);
};

describe('adding a screen', () => {
  it('puts it inside a section that already holds screens', () => {
    const { config, screenId } = addScreen(support(), { title: 'Refund not received', parent: 'payments_refunds' });
    const flow = read(config);
    expect(screenId).toBe('refund_not_received');
    expect(screenOf(flow, screenId)).toMatchObject({ parent: 'payments_refunds', depth: 3, kind: 'message' });
    expect(screenOf(flow, 'payments_refunds').children).toContain(screenId);
    // And the screen it sits in now offers a way to it.
    expect(optionsOf(screenOf(flow, 'payments_refunds')).map((o) => o.value)).toContain(screenId);
    stillLegal(config);
  });

  it('refuses to put a screen inside a Message, and makes room when asked', () => {
    const before = read(support());
    expect(screenOf(before, 'rides_cancel').kind).toBe('message');
    expect(screenOf(before, 'rides_cancel').children).toEqual([]);

    // A Message answers and sends people back; it is given room on purpose.
    expect(() => addScreen(support(), { title: 'Cancellation fee', parent: 'rides_cancel' })).toThrow(/Make it a Menu/);

    const roomy = setScreenType(support(), 'rides_cancel', 'menu');
    expect(screenOf(read(roomy), 'rides_cancel').kind).toBe('menu');
    expect(screenOf(read(roomy), 'rides_cancel').children).toEqual([]);

    const { config, screenId } = addScreen(roomy, { title: 'Cancellation fee', parent: 'rides_cancel' });
    const flow = read(config);
    const leaf = screenOf(flow, 'rides_cancel');
    expect(leaf.kind).toBe('menu');
    expect(leaf.children).toEqual([screenId]);
    // Its own question is now a case inside its own loop — its steps unchanged.
    expect(leaf.frames).toEqual(['root', 'rides', 'rides_current', 'rides_cancel']);
    expect(leaf.prompts[0]!.says[0]).toBe(screenOf(before, 'rides_cancel').prompts[0]!.says[0]);
    expect(claims(config, flow, 'rides_cancel')).toEqual(['rides_cancel', screenId]);
    stillLegal(config);
  });

  it('keeps what a promoted screen fetched, and when it fetches it', () => {
    const { config: withCall, callId } = addCall(support(), 'rides_cancel', { title: 'Trip', request: { method: 'GET', url: 'https://93.184.216.34/trip' } });
    expect(read(withCall).screens.find((s) => s.id === 'rides_cancel')!.calls[0]).toMatchObject({ id: callId, scope: 'screen' });

    const { config } = addScreen(setScreenType(withCall, 'rides_cancel', 'menu'), { title: 'Cancellation fee', parent: 'rides_cancel' });
    const call = read(config).screens.find((s) => s.id === 'rides_cancel')!.calls[0]!;
    // Still the screen's own — promotion moved its steps, not their meaning.
    expect(call).toMatchObject({ id: callId, scope: 'screen' });
  });

  it('refuses what cannot hold a screen', () => {
    expect(() => addScreen(support(), { title: 'x', parent: 'done' })).toThrow(/ends the conversation/);
    expect(() => addScreen(support(), { title: '  ', parent: 'payments' })).toThrow(/needs a name/);
  });
});

describe('moving a screen', () => {
  const moved = () => moveScreen(support(), 'rides_lost_item', 'account');

  it('puts it where it now sits, and fixes what every section claims', () => {
    const config = moved();
    const flow = read(config);
    expect(screenOf(flow, 'rides_lost_item')).toMatchObject({ parent: 'account', depth: 2 });
    expect(claims(config, flow, 'rides')).not.toContain('rides_lost_item');
    expect(claims(config, flow, 'account')).toContain('rides_lost_item');
    expect(screenOf(flow, 'rides_lost_item').prompts[0]!.header).toBe('Account › I left something behind');
    stillLegal(config);
  });

  it('leaves an emptied Menu a Menu — the room is the author’s to keep', () => {
    const roomy = setScreenType(support(), 'rides_cancel', 'menu');
    const one = addScreen(roomy, { title: 'Fee', parent: 'rides_cancel' });
    expect(read(one.config).screens.find((s) => s.id === 'rides_cancel')!.children).toHaveLength(1);

    const back = moveScreen(one.config, one.screenId, 'account');
    const cancel = read(back).screens.find((s) => s.id === 'rides_cancel')!;
    // Empty, but still a Menu: nothing demotes it behind the author's back.
    expect(cancel.children).toEqual([]);
    expect(cancel.kind).toBe('menu');
    expect(cancel.hasFrame).toBe(true);
    expect(cancel.prompts[0]!.says[0]).toBe(read(support()).screens.find((s) => s.id === 'rides_cancel')!.prompts[0]!.says[0]);
    stillLegal(back);

    // And it goes back to a Message when the author says so.
    const plain = read(setScreenType(back, 'rides_cancel', 'message')).screens.find((s) => s.id === 'rides_cancel')!;
    expect(plain.kind).toBe('message');
    expect(plain.hasFrame).toBe(false);
    expect(plain.frames).toEqual(['root', 'rides', 'rides_current']);
  });

  it('refuses to put a screen inside something it holds', () => {
    expect(() => moveScreen(support(), 'payments', 'payments_refunds')).toThrow(/cannot also hold it/);
  });

  it('carries the way in with it, wording and all', () => {
    // Renamed first, so what lands on Account can only be the option itself and
    // not a plain one built from the screen's title.
    const flow0 = read(support());
    const prompt = screenOf(flow0, 'rides_past').prompts[0]!;
    const at = prompt.options.findIndex((o) => o.to.kind === 'screen' && o.to.screen === 'rides_lost_item');
    const renamed = relabelOption(support(), prompt.id, at, 'Something I left in the car');

    const config = moveScreen(renamed, 'rides_lost_item', 'account');
    const flow = read(config);
    const offers = (id: string) => optionsOf(screenOf(flow, id)).map((o) => o.label);
    expect(offers('account')).toContain('Something I left in the car');
    expect(offers('rides_past')).not.toContain('Something I left in the car');

    // Above the ways back, where an option that opens something belongs.
    const list = optionsOf(screenOf(flow, 'account'));
    expect(list.findIndex((o) => o.label === 'Something I left in the car')).toBeLessThan(list.findIndex((o) => o.back));
    stillLegal(config);
  });

  it('re-aims the ways back under what moved', () => {
    const config = moveScreen(support(), 'payments', 'account');
    const flow = read(config);
    // A way back is where a screen sits read backwards, so everything that moved
    // offers a new one — not the chain it had under the old parent.
    expect(backsOf(flow, 'payments')).toEqual(['account', 'root']);
    expect(backsOf(flow, 'payments_refund_status')).toEqual(['payments_refunds', 'payments', 'account', 'root']);
    for (const id of subtreeOf(flow, 'payments')) {
      if (backsOf(flow, id).length > 0) expect(backsOf(flow, id)).toEqual(ancestorsOf(flow, id));
    }
    stillLegal(config);
  });

  it('leaves a screen that had its ways back turned off without them', () => {
    const off = setWayBack(support(), 'payments_refund_status', false);
    const flow = read(moveScreen(off, 'payments', 'account'));
    expect(backsOf(flow, 'payments_refund_status')).toEqual([]);
    expect(backsOf(flow, 'payments_refund_missing')).toEqual(['payments_refunds', 'payments', 'account', 'root']);
  });

  it('says where a screen may go, so the editor offers what the move accepts', () => {
    const flow = read(support());
    expect(moveIsValid(flow, 'rides_lost_item', 'account')).toBe(true);
    // Only a Menu has room inside it.
    expect(moveIsValid(flow, 'rides_lost_item', 'rides_cancel')).toBe(false);
    expect(moveIsValid(flow, 'rides_lost_item', 'done')).toBe(false);
    // Nothing can hold what holds it, and the first screen is the conversation.
    expect(moveIsValid(flow, 'payments', 'payments_refunds')).toBe(false);
    expect(moveIsValid(flow, 'root', 'account')).toBe(false);
    // Where it already is stays on offer — it is the place it is set to.
    expect(moveIsValid(flow, 'rides_lost_item', 'rides_past')).toBe(true);
    expect(moveScreen(support(), 'rides_lost_item', 'rides_past')).toBe(support());
  });

  it('refuses a destination with no room in it', () => {
    expect(() => moveScreen(support(), 'rides_lost_item', 'rides_cancel')).toThrow(/only a Menu can/);
    expect(() => moveScreen(support(), 'rides_lost_item', 'done')).toThrow(/only a Menu can/);
  });
});

describe('renaming and removing', () => {
  it('renames the screen and every option that opens it', () => {
    const config = renameScreen(support(), 'payments_refunds', 'Refunds & credits');
    const flow = read(config);
    expect(screenOf(flow, 'payments_refunds').title).toBe('Refunds & credits');
    expect(optionsOf(screenOf(flow, 'payments')).find((o) => o.value === 'payments_refunds')?.label).toBe('Refunds & credits');
    // A way back keeps its arrow.
    const child = optionsOf(screenOf(flow, 'payments_refund_status')).find((o) => o.value === 'payments_refunds');
    expect(child?.label).toBe('↑ Refunds & credits');
  });

  it('removes a screen and the options that opened it', () => {
    const config = removeScreen(support(), 'rides_lost_item');
    const flow = read(config);
    expect(flow.screens.find((s) => s.id === 'rides_lost_item')).toBeUndefined();
    for (const screen of flow.screens) {
      expect([screen.id, optionsOf(screen).map((o) => o.value)]).toEqual([
        screen.id,
        expect.not.arrayContaining(['rides_lost_item']),
      ]);
    }
    stillLegal(config);
  });

  it('refuses to remove a screen that holds others', () => {
    expect(() => removeScreen(support(), 'payments_refunds')).toThrow(/Move what is inside/);
  });
});

describe('a screen added to a section that fetches', () => {
  it('reads what the section fetched, on the way in', async () => {
    // Payments fetches; a new screen inside it quotes the answer.
    const { config: withCall } = addCall(support(), 'payments', {
      title: 'Refund',
      request: { method: 'GET', url: 'https://93.184.216.34/refunds/{{trigger.context.orderId}}', timeoutMs: 2_000 },
    });
    const added = addScreen(withCall, { title: 'Refund state', parent: 'payments' });
    const flow = read(added.config);
    const wait = partsOf(caseFor(added.config, flow, screenOf(flow, added.screenId))!, flow.routeKey).rest[0]!;
    wait.config['prompt'] = [`It is ${callRef('refund', 'body.status')}.`];
    const config = refreshDerived(added.config);

    const { runtime } = harness();
    const service = answering({ status: 'on its way' });
    const id = await conversationOn(runtime, config, { orderId: 'A-1' });
    await parked(runtime, id);
    await answer(runtime, id, 'payments');
    expect(service.calls).toBe(1);
    expect((await answer(runtime, id, added.screenId)).prompt).toBe('It is on its way.');
    expect(service.calls).toBe(1);
  });
});

/** Nothing above should have depended on the order the cases happen to be in. */
describe('after all of it', () => {
  it('still reads as the same flow it was', () => {
    const before = read(support());
    const after = read(renameScreen(moveScreen(support(), 'rides_lost_item', 'account'), 'account', 'Your account'));
    expect(after.screens.length).toBe(before.screens.length);
    expect(asArray(after.screens.map((s) => s.id)).sort()).toEqual(asArray(before.screens.map((s) => s.id)).sort());
    expect(asRec(after.screens.find((s) => s.id === 'account')!)['title']).toBe('Your account');
  });
});

describe('emptying a screen out', () => {
  it('moves what is inside up to where the screen itself sits', () => {
    const config = emptyScreen(support(), 'rides_past', { kind: 'into', screen: 'rides' });
    const flow = read(config);
    expect(screenOf(flow, 'rides_past').children).toEqual([]);
    // Siblings of the screen they used to be inside, reachable by tapping.
    for (const id of ['rides_receipt', 'rides_lost_item']) {
      expect(screenOf(flow, id).parent).toBe('rides');
      expect(optionsOf(screenOf(flow, 'rides')).some((o) => o.to.kind === 'screen' && o.to.screen === id)).toBe(true);
      expect(backsOf(flow, id)).toEqual(['rides', 'root']);
    }
    stillLegal(config);
  });

  it('moves what is inside anywhere else that has room', () => {
    const config = emptyScreen(support(), 'rides_past', { kind: 'into', screen: 'account' });
    const flow = read(config);
    expect(screenOf(flow, 'rides_past').children).toEqual([]);
    expect(screenOf(flow, 'rides_lost_item').parent).toBe('account');
    expect(backsOf(flow, 'rides_lost_item')).toEqual(['account', 'root']);
    stillLegal(config);
  });

  it('deletes the whole subtree, however deep', () => {
    const before = read(support());
    const doomed = subtreeOf(before, 'payments').slice(1);
    expect(doomed.length).toBe(27);

    const config = emptyScreen(support(), 'payments', { kind: 'delete' });
    const flow = read(config);
    expect(screenOf(flow, 'payments').children).toEqual([]);
    for (const id of doomed) expect(flow.screens.find((s) => s.id === id)).toBeUndefined();
    // And nothing anywhere still offers a way to one of them.
    for (const s of flow.screens) {
      for (const o of optionsOf(s)) if (o.to.kind === 'screen') expect(doomed).not.toContain(o.to.screen);
    }
    stillLegal(config);
  });

  it('refuses a destination that is inside what is being emptied', () => {
    expect(() => emptyScreen(support(), 'rides', { kind: 'into', screen: 'rides_past' })).toThrow(
      /cannot hold what comes out of it/,
    );
  });

  it('refuses a destination with no room, before moving anything', () => {
    expect(() => emptyScreen(support(), 'rides_past', { kind: 'into', screen: 'rides_cancel' })).toThrow(/only a Menu can/);
  });

  it('does nothing to a screen with nothing in it', () => {
    expect(emptyScreen(support(), 'rides_cancel', { kind: 'delete' })).toBe(support());
  });
});
