import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  agentPlanComponent,
  agentPlanFrom,
  isAgentPlanContent,
  isClassicFlowContent,
  planNote,
  planStartsFolded,
  planTagLabel,
  type AgentPlan,
} from '@/src/features/conversation/model/agent-plan';

const flowHtml = (flow: unknown): string =>
  `<div data-flow-json="${JSON.stringify(flow).replaceAll('"', '&quot;')}">Flow JSON</div>`;

const flow = (components: unknown[]): unknown => ({ version: '2', screenId: 'plan', components });
const planFlow = (props: Record<string, unknown>): unknown => flow([{ type: 'plan', props }]);

const TODOS = [
  { id: 'a', text: 'Read **#payments-core**', status: 'done' },
  { id: 'b', text: 'Search docs', status: 'running' },
  { id: 'c', text: 'Write up the answer', status: 'todo' },
];

const plan = (overrides: Partial<AgentPlan>): AgentPlan => ({
  title: 'Finding the answer',
  description: '',
  state: 'done',
  failedLabel: 'Failed',
  steps: [],
  doneCount: 0,
  ...overrides,
});

describe('agentPlanComponent', () => {
  it('takes a message that is only a plan', () => {
    const html = flowHtml(planFlow({ title: 'Plan', phase: 'executing', todos: TODOS }));
    assert.equal(agentPlanComponent(html)?.type, 'plan');
    assert.equal(isAgentPlanContent(html), true);
  });

  it('leaves a proposed plan to the classic card, which runs Approve / Reject', () => {
    assert.equal(
      isAgentPlanContent(flowHtml(planFlow({ phase: 'proposed', todos: TODOS }))),
      false,
    );
    assert.equal(
      isAgentPlanContent(flowHtml(planFlow({ phase: 'proposed', rejected: true, todos: TODOS }))),
      true,
    );
  });

  it('leaves plans that come with anything else', () => {
    const withWords = `<p>Here is the plan</p>${flowHtml(planFlow({ todos: TODOS }))}`;
    assert.equal(isAgentPlanContent(withWords), false);
    assert.equal(
      isAgentPlanContent(
        flowHtml(
          flow([
            { type: 'plan', props: {} },
            { type: 'text', props: {} },
          ]),
        ),
      ),
      false,
    );
    assert.equal(isAgentPlanContent(flowHtml(flow([{ type: 'ticket', props: {} }]))), false);
    assert.equal(isAgentPlanContent('<p>hello</p>'), false);
    assert.equal(isAgentPlanContent(undefined), false);
  });

  it('ignores blank markup around the plan', () => {
    assert.equal(isAgentPlanContent(`<p>&nbsp;</p>${flowHtml(planFlow({ todos: TODOS }))}`), true);
  });
});

describe('isClassicFlowContent', () => {
  it('is a flow card that is not a lone plan', () => {
    assert.equal(isClassicFlowContent(flowHtml(flow([{ type: 'ticket', props: {} }]))), true);
    assert.equal(
      isClassicFlowContent(flowHtml(planFlow({ phase: 'proposed', todos: TODOS }))),
      true,
    );
  });

  it('is not a lone plan or plain words', () => {
    assert.equal(isClassicFlowContent(flowHtml(planFlow({ todos: TODOS }))), false);
    assert.equal(isClassicFlowContent('<p>hello</p>'), false);
    assert.equal(isClassicFlowContent(undefined), false);
  });
});

describe('agentPlanFrom', () => {
  it('reads the steps as plain words with the running one marked', () => {
    const component = agentPlanComponent(
      flowHtml(planFlow({ title: 'Finding the answer', phase: 'executing', todos: TODOS })),
    );
    assert.ok(component);
    const result = agentPlanFrom(component, {});
    assert.ok(result);
    assert.equal(result.state, 'running');
    assert.deepEqual(
      result.steps.map(step => [step.text, step.state]),
      [
        ['Read #payments-core', 'done'],
        ['Search docs', 'running'],
        ['Write up the answer', 'queued'],
      ],
    );
    assert.equal(result.doneCount, 1);
  });

  it('reads a finished plan as done', () => {
    const component = agentPlanComponent(
      flowHtml(
        planFlow({ phase: 'done', todos: TODOS.map(todo => ({ ...todo, status: 'done' })) }),
      ),
    );
    assert.ok(component);
    assert.equal(agentPlanFrom(component, {})?.state, 'done');
  });
});

describe('plan words', () => {
  it('tags each state', () => {
    assert.equal(planTagLabel(plan({ state: 'done' })), 'Done');
    assert.equal(planTagLabel(plan({ state: 'running' })), 'Working');
    assert.equal(planTagLabel(plan({ state: 'pending' })), 'Pending');
    assert.equal(planTagLabel(plan({ state: 'failed', failedLabel: 'Rejected' })), 'Rejected');
  });

  it('notes how far it got', () => {
    const steps = TODOS.map(todo => ({ id: todo.id, text: todo.text, state: 'queued' as const }));
    assert.equal(planNote(plan({})), 'Finding the answer — done');
    assert.equal(planNote(plan({ state: 'running', steps, doneCount: 1 })), '1 of 3 done');
    assert.equal(planNote(plan({ state: 'pending' })), 'Not started');
  });

  it('folds only long finished plans', () => {
    const steps = Array.from({ length: 5 }, (_, index) => ({
      id: String(index),
      text: 'step',
      state: 'done' as const,
    }));
    assert.equal(planStartsFolded(plan({ steps })), true);
    assert.equal(planStartsFolded(plan({ steps: steps.slice(0, 4) })), false);
    assert.equal(planStartsFolded(plan({ state: 'running', steps })), false);
  });
});
