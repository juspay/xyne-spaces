/** The map layout, checked on the real 39-case support flow, folded and unfolded, in both directions. */
import { describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import {
  addCall,
  addInputScreen,
  addScreen,
  outsideMenu,
  readConversationalFlow,
  type ConversationalFlow,
} from '@xyne/workflow-sdk/conversational-flow';
import { CARD_WIDTH, forwardRows, layoutFlow, type CardBox } from './layout.js';
import agentFlow from '../__fixtures__/support-tree.json' with { type: 'json' };

function read(config: WorkflowConfig): ConversationalFlow {
  const flow = readConversationalFlow(config);
  if (!flow) throw new Error('not a conversational flow');
  return flow;
}

describe('layoutFlow', () => {
  const flow = read(agentFlow as unknown as WorkflowConfig);

  const overlaps = (cards: CardBox[]) => {
    const out: string[] = [];
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]!;
        const b = cards[j]!;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) out.push(`${a.id}×${b.id}`);
      }
    }
    return out;
  };

  it.each(['down', 'right'] as const)('places every screen but the router, with no overlaps (%s)', (direction) => {
    const { cards } = layoutFlow(flow, new Set(), direction);
    expect(cards).toHaveLength(flow.screens.length - 1);
    expect(cards.some((c) => c.id === 'classify')).toBe(false);
    expect(overlaps(cards)).toEqual([]);
  });

  it('reads top to bottom on request: each screen a row below its parent, levels lined up', () => {
    const { cards } = layoutFlow(flow, new Set(), 'down');
    const at = new Map(cards.map((c) => [c.id, c]));
    for (const s of flow.screens) {
      if (!s.parent || outsideMenu(s)) continue;
      expect(at.get(s.id)!.y).toBeGreaterThanOrEqual(at.get(s.parent)!.y + at.get(s.parent)!.h);
    }
    const tops = new Map<number, Set<number>>();
    for (const s of flow.screens) {
      if (outsideMenu(s)) continue;
      tops.set(s.depth, (tops.get(s.depth) ?? new Set()).add(at.get(s.id)!.y));
    }
    for (const ys of tops.values()) expect(ys.size).toBe(1);
  });

  it('reading down, sets a screen’s children out left to right in the order its options list them', () => {
    const { cards } = layoutFlow(flow, new Set(), 'down');
    const at = new Map(cards.map((c) => [c.id, c]));
    const root = flow.screens.find((s) => s.id === flow.rootScreen)!;
    const kids = root.prompts[0]!.options.flatMap((o) => (o.to.kind === 'screen' && !o.back ? [o.to.screen] : [])).filter((id) => at.has(id) && flow.screens.find((s) => s.id === id)!.parent === root.id);
    const xs = kids.map((id) => at.get(id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('reads left to right by default: each screen a column right of its parent', () => {
    const { cards } = layoutFlow(flow);
    const at = new Map(cards.map((c) => [c.id, c]));
    for (const s of flow.screens) {
      if (!s.parent || outsideMenu(s)) continue;
      expect(at.get(s.id)!.x - at.get(s.parent)!.x).toBeGreaterThan(CARD_WIDTH);
    }
  });

  it('leaves lines from option rows left to right, and from the card’s foot top to bottom', () => {
    expect(new Set(layoutFlow(flow, new Set(), 'down').edges.map((e) => e.handle))).toEqual(new Set(['bottom']));
    expect(layoutFlow(flow).edges.every((e) => e.handle === 'card' || /:\d+$/.test(e.handle))).toBe(true);
  });

  it('is deterministic', () => {
    expect(layoutFlow(flow)).toEqual(layoutFlow(flow));
    expect(layoutFlow(flow, new Set(), 'right')).toEqual(layoutFlow(flow, new Set(), 'right'));
  });

  it('draws lines to screens beneath and across, never back', () => {
    const { edges } = layoutFlow(flow);
    const back = edges.filter((e) => {
      const from = flow.screens.find((s) => s.id === e.from)!;
      return flow.screens.some((s) => s.id === e.to && isAncestor(flow, e.to, from.id));
    });
    expect(back).toEqual([]);
    // A child line is drawn where a parent offers the screen beneath it. A
    // screen two branches share sits under one of them and is reached across,
    // so having a parent is not on its own a line.
    expect(edges.filter((e) => e.kind === 'child').length).toBe(
      flow.screens.filter(
        (s) =>
          s.parent &&
          !outsideMenu(s) &&
          flow.screens
            .find((p) => p.id === s.parent)!
            .prompts.flatMap((p) => p.options)
            .some((o) => o.to.kind === 'screen' && o.to.screen === s.id),
      ).length,
    );
    // "Card was declined → Days ago" leads across the tree to "Refund not received".
    expect(edges.some((e) => e.kind === 'jump')).toBe(true);
  });

  it('folds a branch into one card that says how much it hides', () => {
    const open = layoutFlow(flow);
    const folded = layoutFlow(flow, new Set(['payments']));
    const payments = folded.cards.find((c) => c.id === 'payments')!;
    expect(payments.hiddenBelow).toBe(open.cards.filter((c) => isAncestor(flow, 'payments', c.id)).length);
    expect(folded.cards.some((c) => c.id === 'payments_double_charge')).toBe(false);
    expect(folded.edges.some((e) => e.from === 'payments' || e.to === 'payments_double_charge')).toBe(false);
    expect(overlaps(folded.cards)).toEqual([]);
    expect(folded.height).toBeLessThan(open.height);
    expect(layoutFlow(flow, new Set(['payments']), 'down').width).toBeLessThan(layoutFlow(flow, new Set(), 'down').width);
  });
});

function isAncestor(flow: ConversationalFlow, ancestor: string, of: string): boolean {
  const parent = new Map(flow.screens.map((s) => [s.id, s.parent]));
  for (let at = parent.get(of); at !== undefined; at = parent.get(at)) if (at === ancestor) return true;
  return false;
}

describe('endings in the picture', () => {
  const base = read(agentFlow as unknown as WorkflowConfig);

  /** The support fixture, with one ending that only Charged twice leads to. */
  const owned = (): ConversationalFlow => {
    const { config, screenId } = addScreen(agentFlow as unknown as WorkflowConfig, {
      title: 'Refunded',
      parent: 'payments_double_charge',
      type: 'end',
    });
    expect(screenId).toBe('refunded');
    return read(config);
  };

  it('draws an ending its one screen leads to beneath that screen, joined by a line', () => {
    const flow = owned();
    const { cards, edges, owned: adopted } = layoutFlow(flow, new Set(), 'down');
    const parent = cards.find((c) => c.id === 'payments_double_charge')!;
    const ending = cards.find((c) => c.id === 'refunded')!;

    expect(adopted.get('payments_double_charge')?.map((s) => s.id)).toEqual(['refunded']);
    expect(ending.y).toBeGreaterThan(parent.y);
    expect(edges).toContainEqual(expect.objectContaining({ from: 'payments_double_charge', to: 'refunded', kind: 'child' }));
  });

  it('leaves a shared way out where it was, with no lines to it', () => {
    // Every Message screen offers "That's all", so the fixture's Finish is shared.
    const { cards, edges, owned: adopted } = layoutFlow(base, new Set(), 'down');
    expect([...adopted.values()].flat().map((s) => s.id)).not.toContain('done');
    const shared = cards.find((c) => c.id === 'done')!;
    const tallest = Math.max(...cards.filter((c) => c.id !== 'done').map((c) => c.y + c.h));
    expect(shared.y).toBeGreaterThanOrEqual(tallest - shared.h);
    expect(edges.some((e) => e.to === 'done')).toBe(false);
  });

  it('hides an owned ending when its screen is folded', () => {
    const flow = owned();
    const { cards } = layoutFlow(flow, new Set(['payments_double_charge']), 'down');
    expect(cards.some((c) => c.id === 'refunded')).toBe(false);
  });
});

describe('what a screen fetches', () => {
  const base = agentFlow as unknown as WorkflowConfig;

  const fetching = (screenId: string, title: string) =>
    addCall(base, screenId, { title, request: { method: 'GET', url: 'https://93.184.216.34/x' } }).config;

  it('is a node in front of the screen it feeds, wherever that screen sits', () => {
    const flow = read(fetching('payments_double_charge', 'The charge'));
    const call = flow.screens.find((s) => s.id === 'payments_double_charge')!.calls[0]!;
    const { cards, edges } = layoutFlow(flow);

    expect(cards.some((c) => c.id === call.id)).toBe(true);
    // The line from the parent arrives at the fetch, and the fetch feeds the screen.
    expect(edges.some((e) => e.to === call.id && e.from === 'payments_ride_charges')).toBe(true);
    expect(edges.some((e) => e.from === call.id && e.to === 'payments_double_charge')).toBe(true);
  });

  it('sits in front of a whole section when that is what it feeds', () => {
    const flow = read(fetching('payments', 'Balance'));
    const call = flow.screens.find((s) => s.id === 'payments')!.calls[0]!;
    const { cards, edges } = layoutFlow(flow);
    const at = new Map(cards.map((c) => [c.id, c]));

    // Reading left to right, it comes before the section it feeds.
    expect(at.get(call.id)!.x).toBeLessThan(at.get('payments')!.x);
    expect(edges.some((e) => e.from === 'root' && e.to === call.id)).toBe(true);
    expect(edges.some((e) => e.from === call.id && e.to === 'payments')).toBe(true);
  });

  it('chains, in the order it is fetched', () => {
    const one = fetching('payments', 'Balance');
    const flow = read(addCall(one, 'payments', { title: 'Limits', request: { method: 'GET', url: 'https://93.184.216.34/y' } }).config);
    const [first, second] = flow.screens.find((s) => s.id === 'payments')!.calls;
    const { edges } = layoutFlow(flow);

    expect(edges.some((e) => e.from === first!.id && e.to === second!.id)).toBe(true);
    expect(edges.some((e) => e.from === second!.id && e.to === 'payments')).toBe(true);
  });
});

describe('a screen that asks for something', () => {
  it('is joined to the screen inside it, which is how answering reads on the map', () => {
    const made = addInputScreen(agentFlow as unknown as WorkflowConfig, {
      parent: 'payments',
      title: 'Tell us more',
      next: { title: 'Looking into it' },
    });
    const flow = read(made.config);
    const laid = layoutFlow(flow, new Set(), 'right');

    // The card is drawn, with room for the row that joins it.
    const card = laid.cards.find((c) => c.id === made.screenId);
    expect(card).toBeTruthy();
    expect(card!.h).toBeGreaterThan(0);

    // And the line to what answering opens is there — without it the screen
    // inside hangs off the map with nothing leading to it.
    expect(laid.edges.some((e) => e.from === made.screenId && e.to === made.nextId)).toBe(true);
    expect(forwardRows(flow.screens.find((s) => s.id === made.screenId)!).map((r) => r.to)).toEqual([made.nextId]);
  });
});
