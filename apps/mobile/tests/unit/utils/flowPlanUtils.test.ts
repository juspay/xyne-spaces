import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPlanComponentViewModel,
  resolvePlanHeaderStatus,
  resolvePlanTodoDisplayStatuses,
  type PlanTodoViewModel,
} from '@/src/utils/flowPlanUtils';
import { getPlanComponentViewModel as getPlanComponentViewModelFromMarkdown } from '@/src/utils/flowJsonMarkdown';

const identity = (text: string): string => text;

describe('resolvePlanHeaderStatus', () => {
  it('maps executing phase to Approved', () => {
    assert.deepEqual(resolvePlanHeaderStatus({ phase: 'executing' }, 0, 2), {
      statusLabel: 'Approved',
      statusTone: 'in_progress',
    });
  });

  it('maps auto-approved executing phase to Auto-approved', () => {
    assert.deepEqual(resolvePlanHeaderStatus({ phase: 'executing', autoApproved: true }, 0, 1), {
      statusLabel: 'Auto-approved',
      statusTone: 'in_progress',
    });
  });

  it('maps done phase to Completed', () => {
    assert.deepEqual(resolvePlanHeaderStatus({ phase: 'done' }, 2, 2), {
      statusLabel: 'Completed',
      statusTone: 'completed',
    });
  });

  it('maps proposed phase to Pending', () => {
    assert.deepEqual(resolvePlanHeaderStatus({ phase: 'proposed' }, 0, 1), {
      statusLabel: 'Pending',
      statusTone: 'pending',
    });
  });

  it('maps rejected plans to Rejected', () => {
    assert.deepEqual(resolvePlanHeaderStatus({ phase: 'proposed', rejected: true }, 0, 1), {
      statusLabel: 'Rejected',
      statusTone: 'failed',
    });
  });
});

describe('createPlanComponentViewModel', () => {
  const executingPlan = {
    type: 'plan',
    props: {
      title: 'Deploy fix',
      phase: 'executing',
      todos: [
        { id: 'a', text: 'Step one', status: 'done' },
        { id: 'b', text: 'Step two', status: 'queued' },
        { id: 'c', text: 'Step three', status: 'queued' },
      ],
    },
  };

  it('shows a loader only on the next incomplete step when in progress', () => {
    const viewModel = createPlanComponentViewModel(executingPlan, identity);
    assert.ok(viewModel);
    assert.equal(viewModel.statusLabel, 'Approved');
    assert.equal(viewModel.statusTone, 'in_progress');
    assert.deepEqual(
      viewModel.todos.map(todo => todo.displayStatus),
      ['done', 'running', 'queued'],
    );
  });

  it('shows Auto-approved when the plan was auto-approved', () => {
    const viewModel = createPlanComponentViewModel(
      {
        type: 'plan',
        props: {
          phase: 'executing',
          autoApproved: true,
          todos: [{ id: 'a', text: 'Step one', status: 'running' }],
        },
      },
      identity,
    );
    assert.ok(viewModel);
    assert.equal(viewModel.statusLabel, 'Auto-approved');
    assert.equal(viewModel.statusTone, 'in_progress');
  });

  it('shows Completed when the plan phase is done', () => {
    const viewModel = createPlanComponentViewModel(
      {
        type: 'plan',
        props: {
          phase: 'done',
          todos: [
            { id: 'a', text: 'Step one', status: 'done' },
            { id: 'b', text: 'Step two', status: 'done' },
          ],
        },
      },
      identity,
    );
    assert.ok(viewModel);
    assert.equal(viewModel.statusLabel, 'Completed');
    assert.equal(viewModel.statusTone, 'completed');
  });

  it('shows Rejected when the plan was rejected', () => {
    const viewModel = createPlanComponentViewModel(
      {
        type: 'plan',
        props: {
          phase: 'proposed',
          rejected: true,
          todos: [{ id: 'a', text: 'Step one', included: true }],
        },
      },
      identity,
    );
    assert.ok(viewModel);
    assert.equal(viewModel.statusLabel, 'Rejected');
    assert.equal(viewModel.statusTone, 'failed');
  });

  it('respects an explicit running todo from the backend', () => {
    const viewModel = createPlanComponentViewModel(
      {
        type: 'plan',
        props: {
          phase: 'executing',
          todos: [
            { id: 'a', text: 'Step one', status: 'done' },
            { id: 'b', text: 'Step two', status: 'queued' },
            { id: 'c', text: 'Step three', status: 'running' },
          ],
        },
      },
      identity,
    );
    assert.ok(viewModel);
    assert.deepEqual(
      viewModel.todos.map(todo => todo.displayStatus),
      ['done', 'queued', 'running'],
    );
  });

  it('removes the loader when every todo is complete', () => {
    const viewModel = createPlanComponentViewModel(
      {
        type: 'plan',
        props: {
          phase: 'executing',
          todos: [
            { id: 'a', text: 'Step one', status: 'done' },
            { id: 'b', text: 'Step two', status: 'done' },
          ],
        },
      },
      identity,
    );
    assert.ok(viewModel);
    assert.deepEqual(
      viewModel.todos.map(todo => todo.displayStatus),
      ['done', 'done'],
    );
  });

  it('does not show a loader while the plan is still pending', () => {
    const viewModel = createPlanComponentViewModel(
      {
        type: 'plan',
        props: {
          phase: 'proposed',
          todos: [
            { id: 'a', text: 'Step one', included: true },
            { id: 'b', text: 'Step two' },
          ],
        },
      },
      identity,
    );
    assert.ok(viewModel);
    assert.equal(viewModel.statusLabel, 'Pending');
    assert.equal(viewModel.statusTone, 'pending');
    assert.deepEqual(
      viewModel.todos.map(todo => todo.displayStatus),
      ['included', 'queued'],
    );
  });
});

describe('resolvePlanTodoDisplayStatuses', () => {
  it('promotes the first incomplete todo to running when executing', () => {
    const todos: PlanTodoViewModel[] = [
      { id: 'a', text: 'One', displayStatus: 'done' },
      { id: 'b', text: 'Two', displayStatus: 'queued' },
      { id: 'c', text: 'Three', displayStatus: 'queued' },
    ];
    assert.deepEqual(
      resolvePlanTodoDisplayStatuses(todos, 'in_progress').map(todo => todo.displayStatus),
      ['done', 'running', 'queued'],
    );
  });
});

describe('getPlanComponentViewModel wrapper', () => {
  it('delegates to flow plan utils through the markdown entrypoint', () => {
    const fromUtils = createPlanComponentViewModel(
      {
        type: 'plan',
        props: { phase: 'executing', todos: [{ id: 'a', text: 'Step', status: 'queued' }] },
      },
      identity,
    );
    const fromMarkdown = getPlanComponentViewModelFromMarkdown({
      type: 'plan',
      props: { phase: 'executing', todos: [{ id: 'a', text: 'Step', status: 'queued' }] },
    });

    assert.deepEqual(fromMarkdown, fromUtils);
  });
});
