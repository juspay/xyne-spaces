/**
 * Where each jump is aimed, on the real support flow.
 *
 * The invariant that matters is structural: a jump must name a cycle that
 * encloses it, or nothing catches it and the run unwinds off the top. The rest
 * is tightness — naming the innermost frame that holds both ends, so a move
 * inside a section keeps what that section fetched.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../engine/config-validator.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asArray, asRec, type Step } from './json.js';
import { writeJumps } from './jumps.js';
import { caseFor } from './locate.js';
import { readConversationalFlow } from './read.js';
import { jumpsIn } from './shape.js';
import { optionsOf, type ConversationalFlow, type Screen } from './types.js';
import agentFlow from './__fixtures__/support-tree.json';

const original = agentFlow as unknown as WorkflowConfig;

function aimed(): { config: WorkflowConfig; flow: ConversationalFlow } {
  const config = original;
  const flow = readConversationalFlow(config)!;
  writeJumps(config, flow);
  return { config, flow: readConversationalFlow(config)! };
}

/** Every jump in one screen's case, with where it is aimed and what it carries. */
function jumpsOf(config: WorkflowConfig, flow: ConversationalFlow, screen: Screen): Array<{ target: string; going: string }> {
  const entry = caseFor(config, flow, screen);
  return jumpsIn(asArray(entry?.['steps'])).map((step: Step) => ({
    target: String(step.config['target']),
    going: String(asRec(step.config['with'])[flow.routeKey]),
  }));
}

describe('aiming the jumps', () => {
  const { config, flow } = aimed();
  const screenOf = (id: string) => flow.screens.find((s) => s.id === id)!;

  it('never names a cycle that does not enclose it', () => {
    const wrong: string[] = [];
    for (const screen of flow.screens) {
      for (const jump of jumpsOf(config, flow, screen)) {
        if (!screen.frames.includes(jump.target)) wrong.push(`${screen.id} → ${jump.target}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('stays in the section when both ends are inside it', () => {
    // Charges holds Ride charges and Other charges: moving between them keeps
    // the frame, so whatever Charges fetched is still in scope on the far side.
    const from = screenOf('payments_ride_charges');
    const to = screenOf('payments_other_charges');
    expect(from.frames).toEqual(['root', 'payments', 'payments_charges', 'payments_ride_charges']);
    expect(to.frames).toEqual(['root', 'payments', 'payments_charges', 'payments_other_charges']);
    const targets = jumpsOf(config, flow, from).map((j) => j.target);
    expect(targets).toContain('payments_charges');
  });

  it('goes out to the conversation when it crosses the tree', () => {
    const targets = jumpsOf(config, flow, screenOf('payments_double_charge')).map((j) => j.target);
    // "Main menu" leaves everything behind.
    expect(targets).toContain('root');
  });

  it('splits an answer that could land in several frames, and still reads as one option list', () => {
    const before = readConversationalFlow(original)!;
    const from = 'payments_ride_charges';
    // The screen has two jumps that carry something: what they picked, and —
    // for typing — the router, which is named outright. Only the first splits.
    const jumps = jumpsOf(config, flow, screenOf(from));
    const pick = jumps.filter((j) => j.going.includes('{{'));
    expect(new Set(pick.map((j) => j.going)).size).toBe(1);
    expect(new Set(pick.map((j) => j.target)).size).toBeGreaterThan(1);

    // And the options still say exactly what they said before the split.
    expect(optionsOf(screenOf(from)).map((o) => [o.label, o.to])).toEqual(
      optionsOf(before.screens.find((s) => s.id === from)!).map((o) => [o.label, o.to]),
    );
  });

  it('keeps every option on every screen, and stays a legal workflow', () => {
    const before = readConversationalFlow(original)!;
    for (const screen of flow.screens) {
      const was = before.screens.find((s) => s.id === screen.id)!;
      expect([screen.id, optionsOf(screen).map((o) => [o.label, o.to])]).toEqual([
        screen.id,
        optionsOf(was).map((o) => [o.label, o.to]),
      ]);
    }
    const validator = new ConfigValidator(new ConnectorRegistry());
    const said = (c: WorkflowConfig) => new Set(validator.validate(c).issues.map((i) => `${i.code}: ${i.message}`));
    const was = said(original);
    expect([...said(config)].filter((issue) => !was.has(issue))).toEqual([]);
  });
});
