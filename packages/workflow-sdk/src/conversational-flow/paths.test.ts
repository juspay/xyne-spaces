/**
 * Reading a real run back onto the tree.
 *
 * The conversation is driven through the runtime and then every step it
 * recorded is asked which screen it belongs to — so this passes only if the
 * paths the engine writes and the tree the editor writes agree.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { WorkflowConfig } from '../types/workflow-config.js';
import { readConversationalFlow } from './read.js';
import { screenAtPath } from './paths.js';
import { rootCycle } from './locate.js';
import { caseKind, casesOf, switchIn } from './shape.js';
import { refreshDerived } from './settle.js';
import { answer, answering, conversationOn, harness, parked, restoreFetch } from './testing.js';
import { addCall } from './edit/calls.js';
import { setPromptSays } from './edit/prompts.js';
import agentFlow from './__fixtures__/support-tree.json';

const original = agentFlow as unknown as WorkflowConfig;

/** Payments fetches; the screen inside it says what was found. */
function fetching(): WorkflowConfig {
  const base = original;
  const { config } = addCall(base, 'payments', {
    title: 'Refund',
    request: { method: 'GET', url: 'https://93.184.216.34/refunds/{{trigger.context.orderId}}', timeoutMs: 2_000 },
  });
  const flow = readConversationalFlow(config)!;
  const prompt = flow.screens.find((s) => s.id === 'payments_refunds')!.prompts[0]!;
  return setPromptSays(config, prompt.id, ['Refunds. {{steps.refund.output.body.status}}.']);
}

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('reading a run back onto the tree', () => {
  it('says which screen every step belonged to, however deep', async () => {
    const config = fetching();
    const flow = readConversationalFlow(config)!;
    const { runtime } = harness();
    answering({ status: 'on its way' });

    const id = await conversationOn(runtime, config, { orderId: 'A-1' });
    await parked(runtime, id);
    await answer(runtime, id, 'payments');
    const deep = await answer(runtime, id, 'payments_refunds');
    expect(deep.prompt).toBe('Refunds. on its way.');

    // The question two frames in belongs to the screen that asked it.
    expect(screenAtPath(config, flow, deep.nodePath)?.id).toBe('payments_refunds');

    const detail = await runtime.getExecutionDetail({} as never, id);
    const seen = new Map<string, string>();
    for (const step of detail?.steps ?? []) {
      const screen = screenAtPath(config, flow, step.stepName);
      if (screen) seen.set(step.stepName.split('/').pop()!, screen.id);
    }

    // The first question, the section's call, and the question inside it.
    expect(seen.get('ask_root')).toBe('root');
    expect(seen.get('refund')).toBe('payments');
    expect(seen.get('ask_payments')).toBe('payments');
    expect(seen.get('ask_payments_refunds')).toBe('payments_refunds');
  });

  it('belongs to the section when it ran on the way in, not to a screen inside it', () => {
    const config = fetching();
    const flow = readConversationalFlow(config)!;
    // A call sits in the section's case but outside its loop, so its path stops
    // at the section — which is exactly whose call it is. The case is found
    // rather than guessed, so moving screens around cannot rot this.
    const routing = switchIn(rootCycle(config)!)!;
    const at = casesOf(routing).findIndex((entry) => {
      const kind = caseKind(entry, flow.routeKey);
      return kind?.kind === 'section' && kind.subtree.includes('payments');
    });
    expect(screenAtPath(config, flow, `root:body#1/${routing.id}:case_${String(at)}#0/refund`)?.id).toBe('payments');
  });

  it('says nothing for a step that is not a screen', () => {
    const config = fetching();
    const flow = readConversationalFlow(config)!;
    expect(screenAtPath(config, flow, 'root:body#0/root_route:default#0/unknown')).toBeUndefined();
    expect(screenAtPath(config, flow, 'somewhere/else')).toBeUndefined();
  });
});
