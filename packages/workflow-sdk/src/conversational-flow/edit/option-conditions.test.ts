/**
 * An option offered only under some data.
 *
 * The claims: the condition is stored on the option and nowhere else, the rest
 * of the screen is untouched by it — and, the one that matters, the person is
 * offered the line only when the condition holds.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ConfigValidator } from '../../engine/config-validator.js';
import { ConnectorRegistry } from '../../connectors/core/connector-registry.js';
import type { Condition, WorkflowConfig } from '../../types/workflow-config.js';
import { createConversationalFlow } from '../create.js';
import { readConversationalFlow } from '../read.js';
import { answering, conversationOn, harness, restoreFetch, seen } from '../testing.js';
import { readTurn } from '../turn.js';
import type { ConversationalFlow, Screen } from '../types.js';
import { addCall } from './calls.js';
import { addOption, setOptionCondition } from './options.js';
import { addScreen } from './screens.js';

const read = (config: WorkflowConfig): ConversationalFlow => readConversationalFlow(config)!;
const screenOf = (config: WorkflowConfig, id: string): Screen => read(config).screens.find((s) => s.id === id)!;
const issues = (config: WorkflowConfig) => new ConfigValidator(new ConnectorRegistry()).validate(config).issues;

/** A first screen that fetches the account, and two things to do from it. */
function flow(): { config: WorkflowConfig; when: Condition } {
  const { config: made } = createConversationalFlow({ title: 'Support' });
  const { config: one } = addScreen(made, { title: 'Track my order', parent: 'start' });
  const { config: two } = addScreen(one, { title: 'Talk to your manager', parent: 'start' });
  const { config, callId } = addCall(two, 'start', {
    title: 'Account',
    request: {
      method: 'GET',
      url: 'https://93.184.216.34/account',
      response: { type: 'json', bodySchema: { type: 'object', properties: { plan: { type: 'string' } } } },
    },
  });
  return { config, when: { variable: `{{steps.${callId}.output.body.plan}}`, operator: 'eq', value: 'priority' } };
}

const optionsAsked = (config: WorkflowConfig) => screenOf(config, 'start').prompts[0]!.options;
const escalation = (config: WorkflowConfig) => optionsAsked(config).findIndex((o) => o.value === 'talk_to_your_manager');

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('offering an option only when a condition holds', () => {
  it('keeps the condition on the option, and changes nothing else', () => {
    const { config, when } = flow();
    const before = optionsAsked(config).map((o) => ({ ...o }));
    const next = setOptionCondition(config, screenOf(config, 'start').prompts[0]!.id, escalation(config), when);

    const now = optionsAsked(next);
    expect(now.map((o) => o.label)).toEqual(before.map((o) => o.label));
    expect(now.map((o) => o.to)).toEqual(before.map((o) => o.to));
    expect(now.filter((o) => o.when)).toHaveLength(1);
    expect(now.find((o) => o.when)?.when).toEqual(when);
    expect(issues(next)).toEqual([]);
  });

  it('takes it away again, leaving exactly what was there', () => {
    const { config, when } = flow();
    const promptId = screenOf(config, 'start').prompts[0]!.id;
    const on = setOptionCondition(config, promptId, escalation(config), when);
    expect(JSON.stringify(setOptionCondition(on, promptId, escalation(on), undefined))).toBe(JSON.stringify(config));
  });

  it('refuses a condition with nothing to test', () => {
    const { config } = flow();
    const promptId = screenOf(config, 'start').prompts[0]!.id;
    expect(() => setOptionCondition(config, promptId, 0, { variable: '', operator: 'eq' })).toThrow(/which value/);
    expect(() => setOptionCondition(config, promptId, 0, { all: [] })).toThrow(/something to test/);
  });

  it('offers the line to one person and not the other', async () => {
    const { config, when } = flow();
    const asked = setOptionCondition(config, screenOf(config, 'start').prompts[0]!.id, escalation(config), when);

    for (const [plan, offered] of [
      ['priority', ['Track my order', 'Talk to your manager']],
      ['standard', ['Track my order']],
    ] as const) {
      answering({ plan });
      const { runtime } = harness();
      const id = await conversationOn(runtime, asked, {});
      const turn = readTurn(await seen(runtime, id));
      expect(turn.reply?.options.map((o) => o.label)).toEqual([...offered]);
      restoreFetch();
    }
  });
});
