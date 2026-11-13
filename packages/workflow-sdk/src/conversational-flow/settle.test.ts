/**
 * Settling: what the config says about itself after something moves.
 *
 * The move here is made by hand — lifting a case out of one switch and dropping
 * it into another — rather than through `moveScreen`, so that what is checked is
 * `settle` alone. Every edit is built on it, so if it can make a crude move true
 * again, they start from something that already holds.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../engine/config-validator.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asArray, asRec, type Rec } from './json.js';
import { caseFor, cycleAt, sectionCaseFor } from './locate.js';
import { readConversationalFlow } from './read.js';
import { refreshDerived, settle } from './settle.js';
import { caseKind, casesOf, partsOf, switchIn } from './shape.js';
import { optionsOf, type ConversationalFlow, type Screen } from './types.js';
import agentFlow from './__fixtures__/support-tree.json';

const original = agentFlow as unknown as WorkflowConfig;

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screenOf = (flow: ConversationalFlow, id: string): Screen => flow.screens.find((s) => s.id === id)!;

/** The screens a section's case says are inside it. */
function claimedBy(config: WorkflowConfig, flow: ConversationalFlow, id: string): string[] {
  const entry = sectionCaseFor(config, flow, screenOf(flow, id));
  const kind = entry ? caseKind(entry, flow.routeKey) : null;
  return kind?.kind === 'section' ? kind.subtree : [];
}

describe('settling a flow', () => {
  it('changes nothing that was already true', () => {
    const once = original;
    const twice = refreshDerived(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('gives each question the breadcrumb as its heading', () => {
    const flow = read(original);
    expect(screenOf(flow, 'payments_double_charge').prompts[0]!.header).toBe(
      'Payments › Charges › Ride charges › Charged twice',
    );
  });

  it('tells the router about the screens its own frame can open', () => {
    const config = original;
    const flow = read(config);
    const router = flow.screens.find((s) => s.kind === 'router');
    // The fixture routes with an agent, not a classifier — nothing to write.
    if (!router || router.router?.mode !== 'classifier') {
      expect(router?.router?.mode).toBe('agent');
      return;
    }
    expect(router.router.candidates).toContain('payments_double_charge');
  });
});

describe('settling after a screen is moved', () => {
  /** Lift "I left something behind" out of Past rides and drop it into Account. */
  function moved(): WorkflowConfig {
    const base = original;
    return settle(base, (draft) => {
      const flow = read(draft);
      const from = screenOf(flow, 'rides_past');
      const to = screenOf(flow, 'account');
      const take = (id: string, section: Screen): Rec => {
        const cycle = cycleAt(draft, section.frames, flow.routeKey)!;
        const cases = asArray(switchIn(cycle)!.config['cases']) as Rec[];
        const at = cases.findIndex((entry) => {
          const kind = caseKind(entry, flow.routeKey);
          return kind?.kind === 'screen' && kind.screen === id;
        });
        return cases.splice(at, 1)[0]!;
      };
      const entry = take('rides_lost_item', from);
      const into = cycleAt(draft, to.frames, flow.routeKey)!;
      (asArray(switchIn(into)!.config['cases']) as Rec[]).push(entry);
    });
  }

  it('puts the screen where it now sits', () => {
    const flow = read(moved());
    const lost = screenOf(flow, 'rides_lost_item');
    expect(lost.parent).toBe('account');
    expect(lost.frames).toEqual(['root', 'account']);
    expect(screenOf(flow, 'rides_past').children).not.toContain('rides_lost_item');
    expect(screenOf(flow, 'account').children).toContain('rides_lost_item');
  });

  it('rewrites the subtree every section claims, above and below', () => {
    const config = moved();
    const flow = read(config);
    expect(claimedBy(config, flow, 'rides_past')).not.toContain('rides_lost_item');
    expect(claimedBy(config, flow, 'rides')).not.toContain('rides_lost_item');
    expect(claimedBy(config, flow, 'account')).toContain('rides_lost_item');
  });

  it('re-aims its jumps at frames that now enclose it', () => {
    const config = moved();
    const flow = read(config);
    const lost = screenOf(flow, 'rides_lost_item');
    const entry = caseFor(config, flow, lost)!;
    const targets = JSON.stringify(partsOf(entry).rest).match(/"target":"([^"]+)"/g) ?? [];
    for (const target of targets) {
      expect([lost.frames, target]).toEqual([lost.frames, expect.stringMatching(new RegExp(`"(${lost.frames.join('|')})"`))]);
    }
  });

  it('keeps its heading, its options and the workflow itself honest', () => {
    const config = moved();
    const flow = read(config);
    const lost = screenOf(flow, 'rides_lost_item');
    expect(lost.prompts[0]!.header).toBe('Account › I left something behind');
    // Its options still point where they did; only the way in changed.
    const before = read(original);
    expect(optionsOf(lost).map((o) => [o.label, o.to])).toEqual(
      optionsOf(screenOf(before, 'rides_lost_item')).map((o) => [o.label, o.to]),
    );

    const validator = new ConfigValidator(new ConnectorRegistry());
    const said = (c: WorkflowConfig) => new Set(validator.validate(c).issues.map((i) => `${i.code}: ${i.message}`));
    expect([...said(config)].filter((issue) => !said(original).has(issue))).toEqual([]);
  });
});

/** Nothing above should have needed the cases to be in any particular order. */
describe('the switch itself', () => {
  it('holds one case per screen or section, and nothing else', () => {
    const config = original;
    const flow = read(config);
    const cycle = cycleAt(config, [flow.rootScreen], flow.routeKey)!;
    for (const entry of casesOf(switchIn(cycle)!)) {
      expect([entry['label'], caseKind(entry, flow.routeKey)?.kind]).toEqual([
        entry['label'],
        expect.stringMatching(/^(screen|section)$/),
      ]);
      expect(asRec(entry).steps).toBeDefined();
    }
  });
});
