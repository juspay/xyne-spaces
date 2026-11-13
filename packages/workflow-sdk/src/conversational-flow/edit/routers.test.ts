/**
 * The router's service, and what the author wants it told.
 *
 * What it may choose is `settle`'s and is checked there; here the question is
 * only whether the author's own settings survive a read.
 */
import { describe, it, expect } from 'vitest';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { readConversationalFlow } from '../read.js';
import { refreshDerived } from '../settle.js';
import { cycleStep, jumpStep, screenCase, switchStep } from '../shape.js';
import type { ConversationalFlow } from '../types.js';
import { setRouterGuidance, setRouterMode, setRouterService } from './routers.js';
import agentFlow from '../__fixtures__/support-tree.json';

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;

/** Two screens and a classifier that opens one of them. */
function classifying(): WorkflowConfig {
  const ask = (id: string, prompt: string) => ({
    id,
    type: 'WAIT',
    config: { mode: 'approval', reason: prompt, prompt: [prompt], form: { fields: [{ type: 'select', name: 'choice', label: 'Choose one', options: [{ label: 'Rides', value: 'rides' }] }] } },
  });
  return {
    trigger: { type: 'MANUAL', config: {} },
    steps: [
      cycleStep('root', { screen: 'root' }, [
        switchStep(
          'root_route',
          [
            screenCase('root', 'Support', [ask('ask_root', 'Hi!'), jumpStep('go_root', 'root', { screen: '{{steps.ask_root.output.resumeData.data.choice}}' })]),
            screenCase('rides', 'Rides', [ask('ask_rides', 'Rides'), jumpStep('go_rides', 'root', { screen: '{{steps.ask_rides.output.resumeData.data.choice}}' })]),
            screenCase('classify', 'Route typed text', [
              { id: 'classify_step', type: 'CLASSIFIER_AGENT', config: { input: '', instructions: '', classes: {} } },
              jumpStep('go_classified', 'root', { screen: '{{steps.classify_step.output.class}}' }),
            ]),
          ],
          [jumpStep('unknown', 'root', { screen: 'root' })],
        ),
      ]),
    ],
  } as unknown as WorkflowConfig;
}

describe('the router', () => {
  it('asks the service the flow was given', () => {
    const config = setRouterService(refreshDerived(classifying()), { model: 'jev-latest', credentialName: 'Jev', minConfidence: 0.5 });
    const router = read(config).screens.find((s) => s.kind === 'router')!.router!;
    expect(router).toMatchObject({ mode: 'classifier', model: 'jev-latest', credentialName: 'Jev', minConfidence: 0.5 });
  });

  it('forgets the credential and the threshold when asked to', () => {
    const on = setRouterService(refreshDerived(classifying()), { model: 'jev-latest', credentialName: 'Jev', minConfidence: 0.5 });
    const off = setRouterService(on, { credentialName: null, minConfidence: null });
    const router = read(off).screens.find((s) => s.kind === 'router')!.router!;
    expect(router.credentialName).toBeUndefined();
    expect(router.minConfidence).toBeUndefined();
    expect(router.model).toBe('jev-latest');
  });

  it('keeps the author’s own words, and puts them first', () => {
    const config = setRouterGuidance(refreshDerived(classifying()), 'classify', 'Prefer Rides for anything about a trip.');
    const router = read(config).screens.find((s) => s.kind === 'router')!.router!;
    expect(router.guidance).toBe('Prefer Rides for anything about a trip.');
    expect(router.task?.startsWith('Prefer Rides for anything about a trip.')).toBe(true);
    // And it still knows what it may open.
    expect(router.candidates).toContain('rides');
  });

  it('refuses a threshold that is not a fraction', () => {
    expect(() => setRouterService(refreshDerived(classifying()), { minConfidence: 2 })).toThrow(/between 0 and 1/);
  });

  it('sends an unsure message back to the frame the router sits in', () => {
    const config = setRouterService(refreshDerived(classifying()), { minConfidence: 0.4 });
    expect(JSON.stringify(config)).toContain('"fallbackClass":"root"');
    expect(JSON.stringify(setRouterService(config, { minConfidence: null }))).not.toContain('fallbackClass');
  });

  it('says so when there is no classifier to configure', () => {
    const agentRouted = agentFlow as unknown as WorkflowConfig;
    expect(() => setRouterService(agentRouted, { model: 'x' })).toThrow(/no classifier/);
  });
});

describe('changing what answers a router', () => {
  it('hands typed messages to an agent, keeping the author’s words and what it may open', () => {
    const guided = setRouterGuidance(refreshDerived(classifying()), 'classify', 'Prefer Rides for anything about a trip.');
    const next = setRouterMode(guided, 'classify', { mode: 'agent', agentSlug: 'ask-ai' });
    const router = read(next).screens.find((s) => s.kind === 'router')!.router!;

    expect(router.mode).toBe('agent');
    expect(router.agent).toBe('ask-ai');
    expect(router.guidance).toBe('Prefer Rides for anything about a trip.');
    expect(router.candidates).toEqual(['root', 'rides']);
    // The jump now carries what the agent answered, not a class.
    expect(JSON.stringify(next)).toContain('{{steps.classify_step.output.response.screen}}');
    expect(JSON.stringify(next)).not.toContain('output.class');
  });

  it('hands them back to the classifier, with the service it is given', () => {
    const asAgent = setRouterMode(refreshDerived(classifying()), 'classify', { mode: 'agent', agentSlug: 'ask-ai' });
    const back = setRouterMode(asAgent, 'classify', { mode: 'classifier', model: 'jev-latest', minConfidence: 0.6 });
    const router = read(back).screens.find((s) => s.kind === 'router')!.router!;

    expect(router).toMatchObject({ mode: 'classifier', model: 'jev-latest', minConfidence: 0.6 });
    expect(router.agent).toBeUndefined();
    expect(router.candidates).toEqual(['root', 'rides']);
    expect(JSON.stringify(back)).toContain('{{steps.classify_step.output.class}}');
    expect(JSON.stringify(back)).not.toContain('output.response.screen');
  });

  it('asks which agent, and refuses a screen that reads nothing', () => {
    const config = refreshDerived(classifying());
    expect(() => setRouterMode(config, 'classify', { mode: 'agent', agentSlug: '  ' })).toThrow(/which agent/);
    expect(() => setRouterMode(config, 'rides', { mode: 'classifier' })).toThrow(/doesn’t read typed messages/);
  });
});
