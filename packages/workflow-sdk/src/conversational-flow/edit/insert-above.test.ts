/**
 * Putting a screen into the path above another.
 *
 * In a tree "above" means inserted between a screen and whatever leads to it,
 * so the claims are about the *path*: the parent reaches the new screen, the new
 * screen reaches the old one, the old one keeps everything it had, and the menu
 * still reads in the order it did.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { readConversationalFlow } from '../read.js';
import { ConversationalFlowEditError } from '../settle.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { insertScreenAbove } from './screens.js';
import tree from '../__fixtures__/support-tree.json';

const base = tree as unknown as WorkflowConfig;
const validator = new ConfigValidator(new ConnectorRegistry());
const read = (c: WorkflowConfig): ConversationalFlow => readConversationalFlow(c)!;
const screen = (c: WorkflowConfig, id: string): Screen => {
  const found = read(c).screens.find((s) => s.id === id);
  if (!found) throw new Error(`no screen ${id}`);
  return found;
};
/** Where a screen's options lead, ignoring the generated ways back. */
const leadsTo = (s: Screen): string[] =>
  s.prompts.flatMap((p) => p.options).filter((o) => !o.back && o.to.kind === 'screen').map((o) => (o.to as { screen: string }).screen);
/** The options as an author reads them: the words, and where each goes. */
const menu = (s: Screen): string[] =>
  s.prompts.flatMap((p) => p.options).filter((o) => !o.back).map((o) => `${o.label} → ${o.to.kind === 'screen' ? o.to.screen : o.to.kind}`);
/** Where "go back" leads, in order. */
const waysBack = (s: Screen): string[] =>
  s.prompts.flatMap((p) => p.options).filter((o) => o.back).map((o) => (o.to as { screen: string }).screen);

function expectValid(config: WorkflowConfig): void {
  const agents = (JSON.stringify(config).match(/"id":"[^"]+","type":"RUN_AGENT"/g) ?? []).map((m) => m.split('"')[3]!);
  const issues = validator.validate(config).issues.filter(
    (i) => !i.message.includes('Unknown step type "RUN_AGENT"') && !agents.some((id) => i.message.includes(`steps.${id}.output`)),
  );
  expect(issues).toEqual([]);
}

describe('inserting a screen above another', () => {
  const target = 'payments_double_charge';
  const parentOf = screen(base, target).parent!;
  const { config: next, screenId: added } = insertScreenAbove(base, target, { title: 'Before charges' });

  it('puts the new screen where the old one was reached from', () => {
    expect(screen(next, added).parent).toBe(parentOf);
    expect(leadsTo(screen(next, parentOf))).toContain(added);
    expectValid(next);
  });

  it('takes the old screen out of the parent’s menu — it is reached through the new one now', () => {
    expect(leadsTo(screen(next, parentOf))).not.toContain(target);
    expect(leadsTo(screen(next, added))).toContain(target);
  });

  it('moves the old screen inside the new one', () => {
    expect(screen(next, target).parent).toBe(added);
  });

  it('keeps the parent’s menu in the order it was', () => {
    const was = leadsTo(screen(base, parentOf));
    const now = leadsTo(screen(next, parentOf));
    // Same positions, with the new screen standing exactly where the old one did.
    expect(now).toEqual(was.map((id) => (id === target ? added : id)));
  });

  it('keeps the words the author wrote on the option that led there', () => {
    // The parent's own option now opens the new screen — same label, same place.
    // Losing it would make the menu read "New screen" where it said something.
    const was = screen(base, parentOf).prompts[0]!.options.find((o) => !o.back && o.to.kind === 'screen' && o.to.screen === target)!;
    expect(menu(screen(next, parentOf))).toContain(`${was.label} → ${added}`);
    expect(menu(screen(next, parentOf)).some((m) => m.startsWith('New screen →'))).toBe(false);
  });

  it('puts the new screen into the way back, for everything that moved', () => {
    // A way back is generated from where a screen sits, and these moved — so
    // "back" has to go through the new screen rather than step over it.
    expect(waysBack(screen(next, target))[0]).toBe(added);
    expect(waysBack(screen(base, target))).not.toContain(added);

    const section = 'payments';
    const { config: moved, screenId: above } = insertScreenAbove(base, section, { title: 'Before payments' });
    for (const id of screen(moved, section).children) {
      expect(waysBack(screen(moved, id))).toContain(above);
    }
  });

  it('leaves a screen that had no way back without one', () => {
    const none = read(next).screens.find((s) => s.parent === target && s.prompts[0]?.options.every((o) => !o.back));
    if (none) expect(waysBack(screen(next, none.id))).toEqual([]);
  });

  it('leaves the old screen’s own options alone', () => {
    expect(leadsTo(screen(next, target))).toEqual(leadsTo(screen(base, target)));
  });

  it('carries a section’s children along with it', () => {
    const section = 'payments';
    const children = screen(base, section).children;
    expect(children.length).toBeGreaterThan(0);
    const { config: moved, screenId: above } = insertScreenAbove(base, section, { title: 'Before payments' });
    expect(screen(moved, section).parent).toBe(above);
    expect(screen(moved, section).children).toEqual(children);
    expectValid(moved);
  });

  it('is a menu, because it holds the screen below it', () => {
    // A kind is read from the shape: anything holding a screen is a menu. The
    // screen below is now inside it, so there is no other answer it could give.
    expect(screen(next, added).kind).toBe('menu');
    expect(screen(next, added).children).toContain(target);
  });

  it('refuses the first screen, and an unnamed one', () => {
    expect(() => insertScreenAbove(base, read(base).rootScreen, { title: 'Nope' })).toThrow(ConversationalFlowEditError);
    expect(() => insertScreenAbove(base, target, { title: '  ' })).toThrow(ConversationalFlowEditError);
  });

  it('is somewhere the router can send people', () => {
    expect(read(next).screens.find((s) => s.kind === 'router')!.router!.candidates).toContain(added);
  });
});
