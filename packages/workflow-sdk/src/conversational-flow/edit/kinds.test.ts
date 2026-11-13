/**
 * Every kind of screen, on the real support flow.
 *
 * The claim each case makes is that a conversion keeps what is the author's —
 * where the screen sits, what it is called, what it says, what the router is
 * told, and anything it fetches on the way in — and rebuilds only the steps that
 * make it that kind of screen.
 *
 * The bare registry has no RUN_AGENT (the host registers it), which the validator
 * reports twice per agent: an unknown step type, and a reference to its output.
 * `expectValid` ignores exactly those, and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { breadcrumb } from '../tree.js';
import { asRec } from '../json.js';
import { readConversationalFlow } from '../read.js';
import { refreshDerived } from '../settle.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { addCall } from './calls.js';
import { setAskAi, setScreenType, whatChangingTypeCosts } from './kinds.js';
import { moveScreen } from './screens.js';
import { ConversationalFlowEditError } from '../settle.js';
import agentFlow from '../__fixtures__/support-tree.json';

const base = agentFlow as unknown as WorkflowConfig;
const validator = new ConfigValidator(new ConnectorRegistry());

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;

function screen(config: WorkflowConfig, id: string): Screen {
  const found = read(config).screens.find((s) => s.id === id);
  if (!found) throw new Error(`no screen ${id}`);
  return found;
}

function expectValid(config: WorkflowConfig): void {
  const agents = (JSON.stringify(config).match(/"id":"[^"]+","type":"RUN_AGENT"/g) ?? []).map((m) => m.split('"')[3]!);
  const issues = validator.validate(config).issues.filter(
    (i) => !i.message.includes('Unknown step type "RUN_AGENT"') && !agents.some((id) => i.message.includes(`steps.${id}.output`)),
  );
  expect(issues).toEqual([]);
}

describe('changing what kind of screen a screen is', () => {
  it('turns a screen into Ask AI, carrying its wording as the intro and keeping its “about”', () => {
    const was = screen(base, 'payments_double_charge');
    const next = setScreenType(base, 'payments_double_charge', 'ask-ai', { agentSlug: 'support-ai' });
    const now = screen(next, 'payments_double_charge');

    expect(now.kind).toBe('ask-ai');
    expect(now.askAi!.intro).toBe(was.prompts[0]!.says[0]);
    expect(now.askAi!.agent).toBe('support-ai');
    expect(now.about).toBe(was.about);
    // It stays where it was, and the router can still open it.
    expect(now.parent).toBe(was.parent);
    expect(screen(next, 'classify').router!.candidates).toContain('payments_double_charge');
    expectValid(next);
  });

  it('turns a screen into an ending, saying what it used to say', () => {
    const was = screen(base, 'payments_double_charge');
    const next = setScreenType(base, 'payments_double_charge', 'end');
    const now = screen(next, 'payments_double_charge');

    expect(now.kind).toBe('end');
    expect(now.endMessage).toBe(was.prompts[0]!.says[0]);
    expect(now.endValue).toEqual({ outcome: 'payments_double_charge' });
    expectValid(next);
  });

  it('turns a screen into a hand off, and settles what the person can do when they are done', () => {
    const next = setScreenType(base, 'payments_double_charge', 'handoff');
    const now = screen(next, 'payments_double_charge');

    expect(now.kind).toBe('handoff');
    // Endings first, then the screens as the tree reads them.
    const offered = now.prompts[0]!.options;
    expect(offered.length).toBeGreaterThan(5);
    expect(offered.every((o) => o.to.kind === 'screen')).toBe(true);
    expect(read(next).screens.filter((s) => s.kind === 'end').map((s) => s.title)).toContain(offered[0]!.label);
    // Nobody is asked to type to a person who is already talking to them.
    expect(now.prompts[0]!.textField).toBeUndefined();
    expectValid(next);
  });

  it('keeps what the screen fetches on the way in', () => {
    const { config: withCall } = addCall(base, 'payments_double_charge', {
      title: 'The charge',
      // A literal address: the SSRF guard resolves names, and tests have no DNS.
      request: { method: 'GET', url: 'https://93.184.216.34/charges/{{trigger.context.orderId}}' },
    });
    const next = setScreenType(withCall, 'payments_double_charge', 'handoff');
    expect(screen(next, 'payments_double_charge').calls.map((c) => c.title)).toEqual(['The charge']);
    expectValid(next);
  });

  it('refuses what would throw work away, and says what to do first', () => {
    expect(() => setScreenType(base, 'payments', 'end')).toThrow(/inside “Payments”/);
    expect(() => setScreenType(base, 'payments', 'ask-ai')).toThrow(ConversationalFlowEditError);
    expect(() => setScreenType(base, 'classify', 'message')).toThrow(/isn’t a screen people see/);
    expect(() => setScreenType(base, read(base).rootScreen, 'end')).toThrow(/opens the conversation/);
  });

  it('is no change when the kind asked for is the one it already is', () => {
    expect(setScreenType(base, 'payments_double_charge', 'message')).toBe(base);
    expect(setScreenType(base, 'payments', 'menu')).toBe(base);
  });

  it('gives a Message room, and takes it back, without rebuilding the screen', () => {
    // Menu and Message are the same steps — the difference is the room beneath.
    const was = screen(base, 'payments_double_charge');
    expect(was.kind).toBe('message');

    const roomy = setScreenType(base, 'payments_double_charge', 'menu');
    const now = screen(roomy, 'payments_double_charge');
    expect(now.kind).toBe('menu');
    expect(now.hasFrame).toBe(true);
    // Nothing it says or offers was touched by the conversion.
    expect(now.prompts[0]!.says[0]).toBe(was.prompts[0]!.says[0]);
    expect(now.prompts[0]!.options.map((o) => o.label)).toEqual(was.prompts[0]!.options.map((o) => o.label));
    expect(now.about).toBe(was.about);
    expectValid(roomy);

    expect(screen(setScreenType(roomy, 'payments_double_charge', 'message'), 'payments_double_charge').kind).toBe('message');
  });

  it('gives a rebuilt screen its room when it is asked to be a Menu', () => {
    // Rebuilding the steps does not make room beneath; without that, asking a
    // Finish to become a Menu quietly handed back a Message.
    const end = read(base).screens.find((s) => s.kind === 'end')!;
    const now = screen(setScreenType(base, end.id, 'menu'), end.id);
    expect(now.kind).toBe('menu');
    expect(now.hasFrame).toBe(true);
  });

  it('refuses to take the room away while screens are inside it', () => {
    expect(() => setScreenType(base, 'payments', 'message')).toThrow(/somewhere else first/);
  });

  it('heads a screen it rebuilt with where that screen sits', () => {
    const next = setScreenType(base, 'payments_double_charge', 'ask-ai', { agentSlug: 'support-ai' });
    const now = screen(next, 'payments_double_charge');
    expect(now.prompts[0]!.header).toBe(breadcrumb(read(next), now));
    expect(now.prompts[0]!.header).toContain('Payments › ');
  });

  it('leaves the rest of the flow alone', () => {
    const next = setScreenType(base, 'payments_double_charge', 'end');
    const others = (config: WorkflowConfig) =>
      read(config)
        .screens.filter((s) => s.id !== 'payments_double_charge')
        .map((s) => [s.id, s.kind, s.parent, s.prompts[0]?.says[0]]);
    expect(others(next)).toEqual(others(base));
  });
});

describe('what an ending reports', () => {
  it('is the outcome, beside whatever it says', () => {
    const ended = setScreenType(base, 'payments_double_charge', 'end');
    const finish = JSON.stringify(ended).includes('"outcome":"payments_double_charge"');
    expect(finish).toBe(true);
    expect(asRec(screen(ended, 'payments_double_charge').endValue)).toEqual({ outcome: 'payments_double_charge' });
  });
});

describe('an Ask AI screen’s own settings', () => {
  const asking = setScreenType(base, 'payments_double_charge', 'ask-ai', { agentSlug: 'support-ai' });

  it('changes the agent, the brief and the intro, keeping the question it is given', () => {
    const next = setAskAi(asking, 'payments_double_charge', {
      agent: 'billing-ai',
      task: 'Answer from the ledger only.',
      intro: 'Ask me about this charge.',
    });
    const now = screen(next, 'payments_double_charge').askAi!;

    expect(now.agent).toBe('billing-ai');
    expect(now.task).toBe('Answer from the ledger only.');
    expect(now.intro).toBe('Ask me about this charge.');
    // What the person typed is still appended to the brief, unchanged.
    expect(JSON.stringify(next)).toContain('Their question: ');
    expectValid(next);
  });

  it('leaves out what it was not asked to change', () => {
    const was = screen(asking, 'payments_double_charge').askAi!;
    const next = setAskAi(asking, 'payments_double_charge', { intro: 'Go ahead.' });
    const now = screen(next, 'payments_double_charge').askAi!;

    expect(now.agent).toBe(was.agent);
    expect(now.task).toBe(was.task);
    expect(now.intro).toBe('Go ahead.');
  });

  it('refuses a screen that does not answer with an agent', () => {
    expect(() => setAskAi(base, 'payments_double_charge', { agent: 'x' })).toThrow(/doesn’t answer with an agent/);
  });
});

describe('the first screen', () => {
  it('says why it cannot change, rather than asking for an outside it has none of', () => {
    // It holds screens, but "move them somewhere else" is not a thing anyone can
    // do here — there is no outside the conversation. The categorical reason wins.
    expect(() => setScreenType(base, 'root', 'message')).toThrow(/always a Menu/);
    for (const type of ['end', 'handoff', 'ask-ai'] as const) {
      expect(() => setScreenType(base, 'root', type)).toThrow(/has to be one people can answer/);
    }
    // And the one that does apply elsewhere still reads as it should.
    expect(() => setScreenType(base, 'rides_past', 'message')).toThrow(/somewhere else first/);
  });
});

describe('what changing the type would cost', () => {
  const costs = (config: WorkflowConfig, id: string, type: Parameters<typeof whatChangingTypeCosts>[2]) =>
    whatChangingTypeCosts(read(config), id, type);

  it('says nothing when nothing is lost', () => {
    // Room is given and taken away; neither throws anything out.
    expect(costs(base, 'rides_cancel', 'menu')).toEqual([]);
    expect(costs(base, 'rides', 'menu')).toEqual([]);
    // A Finish keeps its wording when it becomes a screen that asks.
    expect(costs(base, 'done', 'message')).toEqual([]);
  });

  it('names the options only the kinds that ask can keep', () => {
    expect(costs(base, 'rides', 'end')).toEqual(['every option on this screen']);
    expect(costs(base, 'rides', 'ask-ai')).toEqual(['every option on this screen']);
    // A hand off says nothing of its own, so the wording goes too.
    expect(costs(base, 'rides', 'handoff')).toEqual(['every option on this screen', 'what it says']);
  });

  it('counts a hand off\u2019s options as none of the author\u2019s', () => {
    // `writeHandoffs` puts them there; warning about them would be noise.
    const handed = setScreenType(base, 'rides_cancel', 'handoff');
    expect(screen(handed, 'rides_cancel').prompts.some((p) => p.options.some((o) => !o.back))).toBe(true);
    expect(costs(handed, 'rides_cancel', 'end')).toEqual([]);
  });

  it('names the agent and its task separately, so a list of several reads', () => {
    const asked = setAskAi(setScreenType(base, 'rides_cancel', 'ask-ai'), 'rides_cancel', {
      agent: 'support',
      task: 'Explain the cancellation fee.',
    });
    expect(costs(asked, 'rides_cancel', 'message')).toEqual(['the agent it asks', 'what it is told to do']);
    // A new one is written a task to start from, so that is the usual case too.
    const bare = setScreenType(base, 'rides_cancel', 'ask-ai');
    expect(costs(bare, 'rides_cancel', 'message')).toEqual(['the agent it asks', 'what it is told to do']);
    // Emptied, there is nothing left to warn about losing.
    const cleared = setAskAi(bare, 'rides_cancel', { task: '' });
    expect(costs(cleared, 'rides_cancel', 'message')).toEqual(['the agent it asks']);
  });

  it('says nothing about a change that is not one', () => {
    expect(costs(base, 'rides', 'menu')).toEqual([]);
    expect(costs(base, 'done', 'end')).toEqual([]);
  });
});

describe('the way out of a refusal', () => {
  it('is something the editor can actually do', () => {
    // A section cannot become a Message while it holds screens — they would have
    // nowhere to be. The refusal says to move them, so moving them has to work.
    expect(() => setScreenType(base, 'rides_past', 'message')).toThrow(/somewhere else first/);

    let config = base;
    for (const id of screen(base, 'rides_past').children) config = moveScreen(config, id, 'account');
    expect(screen(config, 'rides_past').children).toEqual([]);

    const plain = setScreenType(config, 'rides_past', 'message');
    expect(screen(plain, 'rides_past').kind).toBe('message');
    // And what moved is still reachable, under its new parent.
    expect(screen(plain, 'rides_lost_item').parent).toBe('account');
  });
});
