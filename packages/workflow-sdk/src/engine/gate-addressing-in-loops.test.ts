/**
 * Addressing a gate by step id alone, inside the control steps that run it more
 * than once.
 *
 * The validator lets a webhook wait sit inside a LOOP or a CYCLE and refuses it
 * inside a MAP. That rule is only honest if one step id really does name one
 * open gate in the first two and several in the third, which is a fact about
 * the executor rather than the validator — so it is checked here, against real
 * runs, not asserted in the rule's own test.
 */

import { describe, it, expect } from 'vitest';
import { testRegistry } from '../testing/test-connector.js';
import { WorkflowExecutor } from './workflow-executor.js';
import { InMemoryPersistenceAdapter } from '../persistence/in-memory-adapter.js';
import { ServiceRegistry } from './service-registry.js';
import { resolveGate, collectStepIds } from '../completion/index.js';
import { BuiltinStepType } from '../types/known-types.js';
import { ConditionOperator } from '../types/operators.js';
import type { WorkflowContext } from '../types/index.js';

async function start(config: Record<string, unknown>, trigger: Record<string, unknown> = {}) {
  const persistence = new InMemoryPersistenceAdapter();
  const executor = new WorkflowExecutor(persistence, testRegistry(), new ServiceRegistry());
  persistence.seedWorkflow({
    id: 'wf_1', status: 'ACTIVE', config: JSON.stringify(config), metadata: null, eventType: 'TEST',
  });
  const executionId = await persistence.createExecution({
    workflowId: 'wf_1',
    status: 'PENDING',
    context: JSON.stringify({ steps: {}, trigger, workflow: { id: 'wf_1', attributes: {} } }),
  });
  return { persistence, executor, executionId, known: collectStepIds(config) };
}

/** What the host does for a caller who sent only a step id. */
async function addressByStepId(
  run: Awaited<ReturnType<typeof start>>,
  stepId: string,
) {
  const execution = (await run.persistence.getExecution(run.executionId))!;
  const rows = await run.persistence.getStepRows(run.executionId);
  return resolveGate({ executionId: run.executionId, stepId }, execution.status, rows, run.known);
}

const buildResult = {
  type: 'object',
  properties: { result: { type: 'string' } },
  required: ['result'],
};

describe('addressing a webhook gate by step id', () => {
  it('names one round at a time through a CYCLE, and the body can break out', async () => {
    // Trigger a build, wait for its result, go round again unless it passed.
    const config = {
      trigger: { type: 'TEST', config: { channel: 'ch_1' } },
      steps: [
        {
          id: 'poll',
          type: BuiltinStepType.CYCLE,
          config: {
            input: { attempt: 1 },
            maxIterations: 10,
            result: { type: 'object', properties: { build: { type: 'object' } }, required: ['build'] },
            body: [
              { id: 'wait_for_build', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: { payload: buildResult } },
              {
                id: 'decide',
                type: BuiltinStepType.CONDITIONAL,
                config: {
                  condition: {
                    variable: '{{steps.wait_for_build.output.body.result}}',
                    operator: ConditionOperator.EQ,
                    value: 'retry',
                  },
                  if_true: [
                    { id: 'again', type: BuiltinStepType.GO_TO, config: { target: 'poll', with: { attempt: 2 } } },
                  ],
                  if_false: [
                    {
                      id: 'done',
                      type: BuiltinStepType.FINISH,
                      config: {
                        target: 'poll',
                        with: { build: '{{steps.wait_for_build.output.body}}' },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    const run = await start(config);
    const addressed: string[] = [];

    for (const result of ['retry', 'retry', 'success']) {
      await run.executor.runExecution(run.executionId);

      const resolved = await addressByStepId(run, 'wait_for_build');
      expect(resolved.kind).toBe('gate');
      if (resolved.kind !== 'gate') return;
      addressed.push(resolved.row.stepName);

      const data = resolved.row.data ? (JSON.parse(resolved.row.data) as Record<string, unknown>) : {};
      data['delivery'] = { payload: { result }, receivedAt: new Date().toISOString() };
      await run.persistence.upsertStep(run.executionId, resolved.row.stepName, {
        status: resolved.row.status,
        executorType: resolved.row.executorType,
        data: JSON.stringify(data),
      });
    }

    await run.executor.runExecution(run.executionId);

    // Each round was a distinct node, and the bare id found the open one.
    expect(addressed).toEqual([
      'poll:body#0/wait_for_build',
      'poll:body#1/wait_for_build',
      'poll:body#2/wait_for_build',
    ]);
    expect((await run.persistence.getExecution(run.executionId))!.status).toBe('COMPLETED');

    // What a step after the cycle would read: the FINISH's value under
    // `result`, the last round's loop state under `state`.
    const state = await run.persistence.getExecutionState(run.executionId);
    const cycle = (JSON.parse(state!.context!) as WorkflowContext).steps['poll']!;
    expect(cycle.output).toMatchObject({
      exit: 'finish',
      rounds: 3,
      result: { build: { result: 'success' } },
      state: { attempt: 2 },
    });
  });

  it('names one item at a time through a LOOP', async () => {
    const config = {
      trigger: { type: 'TEST', config: { channel: 'ch_1' } },
      steps: [
        {
          id: 'each',
          type: BuiltinStepType.LOOP,
          config: {
            source: '{{trigger.items}}',
            body: [{ id: 'callback', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }],
          },
        },
      ],
    };

    const run = await start(config, { items: ['a', 'b', 'c'] });
    await run.executor.runExecution(run.executionId);

    const rows = await run.persistence.getStepRows(run.executionId);
    const open = rows.filter((r) => r.status === 'EXTERNAL_WAIT' && r.executorType !== 'conditional');
    expect(open.map((r) => r.stepName)).toEqual(['each:body#0/callback']);

    const resolved = await addressByStepId(run, 'callback');
    expect(resolved.kind).toBe('gate');
  });

  it('names several at once through a MAP — which is why the validator refuses it', async () => {
    const config = {
      trigger: { type: 'TEST', config: { channel: 'ch_1' } },
      steps: [
        {
          id: 'each',
          type: BuiltinStepType.MAP,
          config: {
            source: '{{trigger.items}}',
            body: [{ id: 'callback', type: BuiltinStepType.WAIT_FOR_WEBHOOK, config: {} }],
          },
        },
      ],
    };

    const run = await start(config, { items: ['a', 'b', 'c'] });
    await run.executor.runExecution(run.executionId);

    const resolved = await addressByStepId(run, 'callback');
    expect(resolved).toEqual({
      kind: 'outcome',
      outcome: {
        kind: 'ambiguous',
        nodePaths: ['each:item#0/callback', 'each:item#1/callback', 'each:item#2/callback'],
      },
    });
  });
});
