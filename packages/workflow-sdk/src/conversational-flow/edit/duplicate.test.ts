/**
 * Copying a screen.
 *
 * Ported from the version written against the flat router SWITCH: in this shape
 * a screen is a case wherever it sits, so a copy is a case beside it (sibling)
 * or a case inside it (child), and the claims are the same — the engine accepts
 * it, something leads to it, nothing inside it collides with the original, and
 * the two can be edited apart.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { readConversationalFlow } from '../read.js';
import { ConversationalFlowEditError } from '../settle.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { duplicateScreen } from './screens.js';
import { setPromptSays } from './prompts.js';
import tree from '../__fixtures__/support-tree.json';

const base = tree as unknown as WorkflowConfig;
const validator = new ConfigValidator(new ConnectorRegistry());
const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screen = (config: WorkflowConfig, id: string): Screen => {
  const found = read(config).screens.find((s) => s.id === id);
  if (!found) throw new Error(`no screen ${id}`);
  return found;
};

/** The bare registry has no RUN_AGENT; those issues are the fixture's, not ours. */
function expectValid(config: WorkflowConfig): void {
  const agents = (JSON.stringify(config).match(/"id":"[^"]+","type":"RUN_AGENT"/g) ?? []).map((m) => m.split('"')[3]!);
  const issues = validator.validate(config).issues.filter(
    (i) => !i.message.includes('Unknown step type "RUN_AGENT"') && !agents.some((id) => i.message.includes(`steps.${id}.output`)),
  );
  expect(issues).toEqual([]);
}

const waits = (c: WorkflowConfig): string[] => read(c).screens.flatMap((s) => s.prompts.map((p) => p.id));
const leadsTo = (s: Screen): string[] =>
  s.prompts.flatMap((p) => p.options).filter((o) => o.to.kind === 'screen').map((o) => (o.to as { screen: string }).screen).sort();

describe('duplicating a screen', () => {
  const { config: next, screenId } = duplicateScreen(base, 'payments_double_charge');
  const source = screen(base, 'payments_double_charge');
  const copy = screen(next, screenId);

  it('adds a copy the engine accepts, inside the same screen', () => {
    expect(screenId).not.toBe('payments_double_charge');
    expect(copy.kind).toBe(source.kind);
    expect(copy.parent).toBe(source.parent);
    expectValid(next);
  });

  it('is reached from the same place the original is', () => {
    const links = screen(next, source.parent!).prompts[0]!.options.filter(
      (o) => o.to.kind === 'screen' && o.to.screen === screenId,
    );
    expect(links).toHaveLength(1);
  });

  it('gives every step inside it a new id', () => {
    const before = new Set(waits(base));
    expect(waits(next).filter((id) => !before.has(id)).length).toBeGreaterThan(0);
    expect(new Set(waits(next)).size).toBe(waits(next).length);
  });

  it('leads wherever the original did', () => {
    expect(leadsTo(copy)).toEqual(leadsTo(source));
  });

  it('is a copy, not a share: editing one leaves the other alone', () => {
    const changed = setPromptSays(next, copy.prompts[0]!.id, ['Changed only here']);
    expect(screen(changed, 'payments_double_charge').prompts[0]!.says[0]).toBe(source.prompts[0]!.says[0]);
    expect(screen(changed, screenId).prompts[0]!.says[0]).toBe('Changed only here');
    expectValid(changed);
  });

  it('is somewhere the router can send people', () => {
    const router = read(next).screens.find((s) => s.kind === 'router')!.router!;
    expect(router.candidates).toContain(screenId);
  });

  it('refuses the router, and the first screen as a sibling', () => {
    const router = read(base).screens.find((s) => s.kind === 'router')!;
    expect(() => duplicateScreen(base, router.id)).toThrow(ConversationalFlowEditError);
    expect(() => duplicateScreen(base, read(base).rootScreen)).toThrow(ConversationalFlowEditError);
  });

  describe('inside the original', () => {
    const { config: inside, screenId: childId } = duplicateScreen(base, 'payments', { as: 'child' });

    it('hangs the copy beneath it, not beside it', () => {
      expect(screen(inside, childId).parent).toBe('payments');
      expectValid(inside);
    });

    it('is reached from the original itself', () => {
      const links = screen(inside, 'payments').prompts[0]!.options.filter(
        (o) => o.to.kind === 'screen' && o.to.screen === childId,
      );
      expect(links).toHaveLength(1);
    });

    it('refuses a screen that shows no options', () => {
      const end = read(base).screens.find((s) => s.kind === 'end')!;
      expect(() => duplicateScreen(base, end.id, { as: 'child' })).toThrow(ConversationalFlowEditError);
    });
  });
});
