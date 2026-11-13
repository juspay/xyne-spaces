/**
 * A screen that asks differently depending on the data.
 *
 * The claims: the config is wrapped and unwrapped cleanly, each version is a
 * whole way of asking, and — the one that matters — the right one runs.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { WorkflowConfig } from '../../types/workflow-config.js';
import { createConversationalFlow } from '../create.js';
import { readConversationalFlow } from '../read.js';
import { answer, answering, conversationOn, harness, parked, restoreFetch } from '../testing.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { addCall } from './calls.js';
import { addOption } from './options.js';
import { setPromptSays } from './prompts.js';
import { addScreen } from './screens.js';
import { addVersion, removeVersion, setVersionWhen } from './versions.js';

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screenOf = (config: WorkflowConfig, id: string): Screen => read(config).screens.find((s) => s.id === id)!;
const issues = (config: WorkflowConfig) => new ConfigValidator(new ConnectorRegistry()).validate(config).issues;

/** A flow whose first screen fetches something worth branching on. */
function fetching(): { config: WorkflowConfig; when: { variable: string; operator: string; value: string } } {
  const { config: made } = createConversationalFlow({ title: 'Support' });
  const { config: grown } = addScreen(made, { title: 'Your plan', parent: 'start' });
  const { config, callId } = addCall(grown, 'start', {
    title: 'Account',
    request: {
      method: 'GET',
      url: 'https://93.184.216.34/account',
      response: { type: 'json', bodySchema: { type: 'object', properties: { plan: { type: 'string' } } } },
    },
  });
  return { config, when: { variable: `{{steps.${callId}.output.body.plan}}`, operator: 'eq', value: 'priority' } };
}

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('asking differently', () => {
  it('wraps what is already there, and leaves it untouched', () => {
    const { config, when } = fetching();
    const before = JSON.stringify(screenOf(config, 'your_plan').prompts[0]);
    const { config: next, promptId } = addVersion(config, 'your_plan', when);

    const prompts = screenOf(next, 'your_plan').prompts;
    expect(prompts).toHaveLength(2);
    // The new one is asked under the condition; the old one is unchanged and
    // is still what the screen asks when nothing else holds.
    expect(prompts.find((p) => p.id === promptId)?.when).toEqual(when);
    const otherwise = prompts.find((p) => !p.when)!;
    expect(otherwise.id).toBe(JSON.parse(before).id);
    expect(otherwise.says[0]).toBe(JSON.parse(before).says[0]);
    expect(issues(next)).toEqual([]);
  });

  it('starts as a copy, then each version goes its own way', () => {
    const { config, when } = fetching();
    const { config: two, promptId } = addVersion(config, 'your_plan', when);
    const said = setPromptSays(two, promptId, ['You’re on our priority plan.']);
    const both = addOption(said, promptId, { label: 'Talk to your manager', screen: 'done' });

    const prompts = screenOf(both, 'your_plan').prompts;
    const priority = prompts.find((p) => p.when)!;
    const otherwise = prompts.find((p) => !p.when)!;
    expect(priority.says[0]).toBe('You’re on our priority plan.');
    expect(otherwise.says[0]).not.toBe(priority.says[0]);
    expect(priority.options.map((o) => o.label)).toContain('Talk to your manager');
    expect(otherwise.options.map((o) => o.label)).not.toContain('Talk to your manager');
    expect(issues(both)).toEqual([]);
  });

  it('unwraps to exactly what it was when the last one goes', () => {
    const { config, when } = fetching();
    const { config: two, promptId } = addVersion(config, 'your_plan', when);
    const back = removeVersion(two, promptId);
    expect(JSON.stringify(back)).toBe(JSON.stringify(config));
  });

  it('changes when a version is asked, and refuses what cannot be one', () => {
    const { config, when } = fetching();
    const { config: two, promptId } = addVersion(config, 'your_plan', when);
    const other = setVersionWhen(two, promptId, { ...when, value: 'standard' });
    expect(screenOf(other, 'your_plan').prompts.find((p) => p.when)?.when?.value).toBe('standard');

    const otherwise = screenOf(two, 'your_plan').prompts.find((p) => !p.when)!.id;
    expect(() => removeVersion(two, otherwise)).toThrow(/nothing else holds/);
    // A router asks nothing and closes nothing, so there is no second way to
    // do either. A Finish is the exception, and has its own test below.
    expect(() => addVersion(config, 'ai_router', when)).toThrow(/doesn’t ask anything/);
  });

  it('gives a Finish more than one way to close, though it asks nothing', () => {
    const { config, when } = fetching();
    const { config: next, promptId } = addVersion(config, 'done', when);

    const done = screenOf(next, 'done');
    expect(done.versions.map((v) => v.promptId)).toEqual([promptId, 'finish']);
    expect(done.versions.find((v) => v.when)?.when).toEqual(when);
    // The last carries no condition: it is how the screen closes otherwise.
    expect(done.versions.at(-1)?.when).toBeUndefined();
    // Each closes with its own value, which is the point of the second one.
    expect(done.versions.every((v) => v.endValue !== undefined)).toBe(true);
    expect(issues(next)).toEqual([]);
  });

  it('asks the one whose condition holds', async () => {
    const { config, when } = fetching();
    const { config: two, promptId } = addVersion(config, 'your_plan', when);
    const flow = setPromptSays(two, promptId, ['You’re on our priority plan.']);

    for (const [plan, expected] of [['priority', 'You’re on our priority plan.'], ['standard', '']] as const) {
      const service = answering({ plan });
      const { runtime } = harness();
      const id = await conversationOn(runtime, flow, {});
      await parked(runtime, id);
      const asked = await answer(runtime, id, 'your_plan');
      if (expected) expect(asked.prompt).toBe(expected);
      else expect(asked.prompt).not.toBe('You’re on our priority plan.');
      expect(service.calls).toBe(1);
      restoreFetch();
    }
  });
});
