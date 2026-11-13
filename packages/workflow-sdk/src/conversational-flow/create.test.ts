/**
 * A new conversation: the smallest one that runs, and grows.
 *
 * The last case is the one that matters — the starter is driven on the real
 * runtime, so "the smallest one that runs" is a claim and not a hope.
 */
import { describe, it, expect } from 'vitest';
import { ConfigValidator } from '../engine/config-validator.js';
import { ConnectorRegistry } from '../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { asRec, type Rec } from './json.js';
import { readConversationalFlow } from './read.js';
import { addScreen } from './edit/screens.js';
import { setAbout } from './edit/prompts.js';
import { createConversationalFlow, CONVERSATIONAL_FLOW_KIND } from './create.js';
import { conversationOn, harness, parked } from './testing.js';
import type { ConversationalFlow } from './types.js';

function read(config: WorkflowConfig): ConversationalFlow {
  const flow = readConversationalFlow(config);
  if (!flow) throw new Error('not a conversational flow');
  return flow;
}

/** The deciding step's config, wherever in the tree its case sits. */
function routerStep(config: WorkflowConfig, stepId = 'classify'): Rec {
  const found = (value: unknown): Rec | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = found(item);
        if (hit) return hit;
      }
      return undefined;
    }
    if (!value || typeof value !== 'object') return undefined;
    const rec = value as Rec;
    if (rec['id'] === stepId && rec['config']) return asRec(rec['config']);
    for (const inner of Object.values(rec)) {
      const hit = found(inner);
      if (hit) return hit;
    }
    return undefined;
  };
  const step = found(config.steps);
  if (!step) throw new Error(`no step ${stepId}`);
  return step;
}

describe('a new conversation', () => {
  const { config, metadata } = createConversationalFlow();
  const flow = read(config);

  it('is a first screen, a router and a Finish, all inside the conversation', () => {
    expect(metadata).toEqual({ kind: CONVERSATIONAL_FLOW_KIND });
    expect(flow.rootScreen).toBe('start');
    expect(flow.screens.map((s) => [s.id, s.kind])).toEqual([
      ['start', 'menu'],
      ['ai_router', 'router'],
      ['done', 'end'],
    ]);
    // The conversation's cycle is the first screen, so everything else is in it.
    expect(flow.screens.map((s) => s.frames)).toEqual([['start'], ['start'], ['start']]);
    expect(flow.screens[0]!.children).toEqual(['ai_router', 'done']);
  });

  it('sends what they type to the router, and what they tap to the screen they tapped', () => {
    const prompt = flow.screens[0]!.prompts[0]!;
    expect(prompt.freeText).toEqual({ kind: 'screen', screen: 'ai_router' });
    expect(prompt.options).toEqual([]);
  });

  it('asks the classifier what they typed, among the screens it can open', () => {
    const step = routerStep(config);
    expect(step['input']).toBe('{{steps.__loop.output.input.text}}');
    // The Finish is left out until its author says when it applies; the router
    // itself is never a place to send anyone.
    expect(Object.keys(asRec(step['classes']))).toEqual(['start']);
    expect(String(step['instructions'])).toContain('start (Start)');
  });

  it('is a config the engine accepts', () => {
    expect(new ConfigValidator(new ConnectorRegistry()).validate(config).issues).toEqual([]);
  });

  it('grows: a new screen becomes a case in the conversation, and a class on the router', () => {
    const { config: next, screenId } = addScreen(config, { title: 'Payments', parent: 'start' });
    const grown = read(next);
    expect(grown.screens.find((s) => s.id === screenId)!.parent).toBe('start');
    expect(Object.keys(asRec(routerStep(next)['classes']))).toEqual(['start', 'payments']);

    const described = setAbout(next, 'payments', 'they ask about a charge');
    expect(asRec(routerStep(described)['classes'])['payments']).toBe('Payments — they ask about a charge');
  });

  it('runs: it greets, and typing goes to the router', async () => {
    const { runtime } = harness();
    const id = await conversationOn(runtime, config, {});
    const asked = await parked(runtime, id);
    expect(asked.prompt).toBe('Hi! How can I help?');
    expect(asked.nodePath).toContain('ask_start');
  });
});

describe('what a new conversation routes with', () => {
  it('is the classifier, unless an agent is asked for', () => {
    const router = (made: { config: WorkflowConfig }) => read(made.config).screens.find((s) => s.kind === 'router')!.router!;
    expect(router(createConversationalFlow()).mode).toBe('classifier');
    expect(router(createConversationalFlow({ agentSlug: 'ask-ai' })).mode).toBe('agent');
    expect(router(createConversationalFlow({ agentSlug: 'ask-ai' })).agent).toBe('ask-ai');
  });

  it('keeps the service the author asked for, and puts an unsure message back where they are', () => {
    const { config } = createConversationalFlow({
      router: { kind: 'classifier', model: 'jev-latest', credentialName: 'typesafe', minConfidence: 0.55 },
    });
    expect(routerStep(config)).toMatchObject({
      model: 'jev-latest',
      credentialName: 'typesafe',
      minConfidence: 0.55,
      fallbackClass: 'start',
    });
  });

  it('tells an agent what to answer with, and which ids are allowed', () => {
    const { config } = createConversationalFlow({ agentSlug: 'ask-ai' });
    const grown = addScreen(config, { title: 'Payments', parent: 'start' }).config;
    const step = routerStep(grown);
    expect(String(step['task'])).toContain('{{steps.__loop.output.input.text}}');
    expect(String(step['task'])).toContain('"screen": "<id from the list>"');
    expect(asRec(asRec(step['outputSchema'])['properties'])['screen']).toEqual({
      type: 'string',
      enum: ['start', 'payments'],
    });
    expect(JSON.stringify(grown)).toContain('{{steps.classify.output.response.screen}}');
  });
});
