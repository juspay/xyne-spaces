/**
 * Keeping typed messages inside a section.
 *
 * The claim is that scoping needs no new field anywhere: a router placed inside a
 * section serves that section because of where it is, and everything else — what
 * it may choose, where an unsure message goes — follows from that.
 *
 * So what is checked here is position and the two things that follow from it:
 * which screens each router may choose, and which router each screen's typing
 * names — including the exceptions an author makes, and the repair when a screen
 * moves out from under the router it named.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { asArray } from '../json.js';
import { readConversationalFlow } from '../read.js';
import { candidatesOf, routerFor, routersFor, routersOf, scopeOf } from '../routers.js';
import { refreshDerived } from '../settle.js';
import { stepIn } from '../shape.js';
import { subtreeOf } from '../tree.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { scopeRouter, setRouterService, setTypedRouter } from './routers.js';
import { addScreen } from './screens.js';
import { createConversationalFlow } from '../create.js';
import { moveScreen } from './screens.js';
import agentFlow from '../__fixtures__/support-tree.json';

const base = agentFlow as unknown as WorkflowConfig;
const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screen = (config: WorkflowConfig, id: string): Screen => read(config).screens.find((s) => s.id === id)!;

/** Where a router sends a message it could not place. */
function fallbackOf(config: WorkflowConfig, router: Screen): unknown {
  return stepIn(asArray(config.steps), router.router?.stepId ?? '')?.config['fallbackClass'];
}

/**
 * The bare registry has no RUN_AGENT — the host registers it — which the
 * validator reports twice per agent, and nothing else is tolerated.
 */
function expectValid(config: WorkflowConfig): void {
  const agents = (JSON.stringify(config).match(/"id":"[^"]+","type":"RUN_AGENT"/g) ?? []).map((m) => m.split('"')[3]!);
  const issues = new ConfigValidator(new ConnectorRegistry()).validate(config).issues.filter(
    (i) => !i.message.includes('Unknown step type "RUN_AGENT"') && !agents.some((id) => i.message.includes(`steps.${id}.output`)),
  );
  expect(issues).toEqual([]);
}

describe('keeping typed messages inside a section', () => {
  const scoped = scopeRouter(base, 'payments', true);

  it('puts a router inside the section, serving it and everything below it', () => {
    const flow = read(scoped);
    const router = routersOf(flow).find((r) => scopeOf(flow, r)?.id === 'payments')!;

    expect(router.frames).toEqual(['root', 'payments']);
    expect(router.router!.mode).toBe(screen(base, 'classify').router!.mode);
    // What it may choose is Payments and what is inside it, plus the ways out a
    // message that isn't about Payments needs.
    const inside = new Set(subtreeOf(flow, 'payments'));
    const escapes = new Set([flow.rootScreen, ...flow.screens.filter((s) => s.kind === 'handoff').map((s) => s.id)]);
    expect(candidatesOf(flow, router).every((s) => inside.has(s.id) || escapes.has(s.id))).toBe(true);
    expect(candidatesOf(flow, router).some((s) => s.id === flow.rootScreen)).toBe(true);
    expect(candidatesOf(flow, router).filter((s) => inside.has(s.id)).length).toBeGreaterThan(3);
    expectValid(scoped);
  });

  it('sends every screen inside the section to it, and leaves the rest alone', () => {
    const flow = read(scoped);
    const router = routersOf(flow).find((r) => scopeOf(flow, r)?.id === 'payments')!;

    for (const id of subtreeOf(flow, 'payments')) {
      if (!screen(scoped, id).prompts.some((p) => p.freeText)) continue;
      expect([id, routerFor(flow, id)?.id]).toEqual([id, router.id]);
    }
    expect(routerFor(flow, 'rides')?.id).toBe('classify');
  });

  it('gives it up again, and the section falls back to the router outside', () => {
    const back = scopeRouter(scoped, 'payments', false);
    const flow = read(back);

    expect(routersOf(flow).map((r) => r.id)).toEqual(['classify']);
    expect(routerFor(flow, 'payments_double_charge')?.id).toBe('classify');
    expect(read(back).screens.map((s) => s.id).sort()).toEqual(read(base).screens.map((s) => s.id).sort());
    expectValid(back);
  });

  it('is nothing to do twice, and refuses where there is nothing to keep', () => {
    expect(scopeRouter(scoped, 'payments', true)).toBe(scoped);
    expect(scopeRouter(base, 'payments', false)).toBe(base);
    expect(() => scopeRouter(base, 'payments_double_charge', true)).toThrow(/nothing to keep typing in/);
    expect(() => scopeRouter(base, read(base).rootScreen, true)).toThrow(/already serves everything/);
  });

  it('lets one screen ask a router further out, as an exception', () => {
    const flow = read(scoped);
    const router = routersOf(flow).find((r) => scopeOf(flow, r)?.id === 'payments')!;
    expect(routersFor(flow, 'payments_double_charge').map((r) => r.id)).toEqual([router.id, 'classify']);

    const excepted = setTypedRouter(scoped, 'payments_double_charge', 'classify');
    expect(routerFor(read(excepted), 'payments_double_charge')?.id).toBe('classify');
    // Its neighbours are untouched.
    expect(routerFor(read(excepted), 'payments_refunds')?.id).toBe(router.id);
  });

  it('refuses a router that could never be reached from the screen', () => {
    const flow = read(scoped);
    const router = routersOf(flow).find((r) => scopeOf(flow, r)?.id === 'payments')!;
    expect(() => setTypedRouter(scoped, 'rides', router.id)).toThrow(/cannot reach it/);
  });

  it('sends a screen added inside the section to it too', () => {
    const { config: grown, screenId } = addScreen(scoped, { title: 'Promo codes', parent: 'payments' });
    const flow = read(grown);
    const router = routersOf(flow).find((r) => scopeOf(flow, r)?.id === 'payments')!;
    expect(routerFor(flow, screenId)?.id).toBe(router.id);
    expectValid(grown);
  });

  it('repairs a screen moved out of the section it was scoped to', () => {
    const moved = moveScreen(scoped, 'payments_double_charge', 'rides');
    const flow = read(moved);
    // Its old router is no longer above it, so what it names has to change.
    expect(routersFor(flow, 'payments_double_charge').map((r) => r.id)).toEqual(['classify']);
    expect(routerFor(flow, 'payments_double_charge')?.id).toBe('classify');
    expectValid(moved);
  });
});

describe('where an unsure message goes', () => {
  /** A flow that routes with a classifier, with a section to scope. */
  function classifying(): WorkflowConfig {
    const { config: made } = createConversationalFlow({ title: 'Support' });
    const { config: withSection } = addScreen(made, { title: 'Payments', parent: 'start', type: 'menu' });
    const { config: withLeaf } = addScreen(withSection, { title: 'Refunds', parent: 'payments' });
    return setRouterService(withLeaf, { minConfidence: 0.5 });
  }

  it('is the section itself for the router inside it, and the first screen for the one outside', () => {
    const scoped = scopeRouter(classifying(), 'payments', true);
    const flow = read(scoped);
    const inside = routersOf(flow).find((r) => scopeOf(flow, r)?.id === 'payments')!;
    const outside = routersOf(flow).find((r) => scopeOf(flow, r) === undefined)!;

    expect(fallbackOf(scoped, inside)).toBe('payments');
    expect(fallbackOf(scoped, outside)).toBe(flow.rootScreen);
    expect(new ConfigValidator(new ConnectorRegistry()).validate(scoped).issues).toEqual([]);
  });

  it('asks the same service the flow was given', () => {
    const scoped = scopeRouter(setRouterService(classifying(), { model: 'jev-latest', credentialName: 'typesafe' }), 'payments', true);
    const flow = read(scoped);
    const inside = routersOf(flow).find((r) => scopeOf(flow, r)?.id === 'payments')!;
    expect(inside.router).toMatchObject({ mode: 'classifier', model: 'jev-latest', credentialName: 'typesafe' });
  });
});
