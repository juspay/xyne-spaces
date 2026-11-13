import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import type { WorkflowConfig } from '@xyne/workflow-sdk/builder';
import { ConditionOperator } from '@xyne/workflow-sdk/builder';
import { WorkflowUIProvider } from '../components/provider/WorkflowUIProvider.js';
import { useWorkflowBuilder } from './use-workflow-builder.js';

const client = {
  schema: {
    trigger: vi.fn().mockResolvedValue(null),
    operators: vi.fn().mockResolvedValue([]),
    availableContext: vi.fn().mockResolvedValue({}),
  },
} as unknown as WorkflowClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <WorkflowUIProvider
    client={client}
    queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    {children}
  </WorkflowUIProvider>
);

/** A binding that waits two hours after the event before it runs. */
const delayed: WorkflowConfig = {
  trigger: {
    type: 'TICKET_CREATED',
    config: { boardIds: ['b_1'] },
    start: { kind: 'delay', offset: { amount: 2, unit: 'hours' } },
  },
  steps: [],
};

function builder(initialConfig: WorkflowConfig) {
  return renderHook(() => useWorkflowBuilder({ initialConfig }), { wrapper });
}

describe('the trigger binding survives editing', () => {
  it('keeps the start policy when the filter changes', () => {
    // The regression this guards: `updateTriggerFilter` used to REBUILD the
    // binding from type + config + filter, so a delay set through the API or an
    // authoring tool vanished the moment anyone touched the filter here.
    const { result } = builder(delayed);

    act(() => {
      result.current.updateTriggerFilter({
        conditions: { variable: '{{trigger.status}}', operator: ConditionOperator.EQ, value: 'Backlog' },
      });
    });

    expect(result.current.config.trigger.start).toEqual({
      kind: 'delay',
      offset: { amount: 2, unit: 'hours' },
    });
    expect(result.current.config.trigger.config).toEqual({ boardIds: ['b_1'] });
  });

  it('keeps the start policy when the trigger config changes', () => {
    const { result } = builder(delayed);

    act(() => {
      result.current.updateTriggerConfig({ boardIds: ['b_1', 'b_2'] });
    });

    expect(result.current.config.trigger.start).toEqual({
      kind: 'delay',
      offset: { amount: 2, unit: 'hours' },
    });
  });

  it('keeps the filter when the start policy changes', () => {
    const withFilter: WorkflowConfig = {
      ...delayed,
      trigger: {
        ...delayed.trigger,
        filter: {
          conditions: { variable: '{{trigger.status}}', operator: ConditionOperator.EQ, value: 'Backlog' },
        },
      },
    };
    const { result } = builder(withFilter);

    act(() => {
      result.current.updateTriggerStart({
        kind: 'at',
        anchor: '{{trigger.ticket.eta}}',
        ifPast: 'skip',
      });
    });

    expect(result.current.config.trigger.filter).toEqual(withFilter.trigger.filter);
    expect(result.current.config.trigger.start).toEqual({
      kind: 'at',
      anchor: '{{trigger.ticket.eta}}',
      ifPast: 'skip',
    });
  });

  it('removes the delay when the start policy is cleared', () => {
    const { result } = builder(delayed);

    act(() => {
      result.current.updateTriggerStart(undefined);
    });

    expect(result.current.config.trigger.start).toBeUndefined();
    expect('start' in result.current.config.trigger).toBe(false);
  });

  it('clears the start policy when the trigger itself changes', () => {
    // Deliberate: an anchor names the old trigger's own fields, so it cannot
    // survive a different trigger.
    const { result } = builder(delayed);

    act(() => {
      result.current.setTrigger('EMAIL_RECEIVED', {});
    });

    expect(result.current.config.trigger.start).toBeUndefined();
    expect(result.current.config.trigger.type).toBe('EMAIL_RECEIVED');
  });
});

/**
 * A flow with a step inside a branch, so "above" has to mean the right list.
 * The branch key is the config path the branch sits at, which is what every
 * other caller uses and what `addStep` writes back through.
 */
const nested: WorkflowConfig = {
  trigger: { type: 'TICKET_CREATED', config: {} },
  steps: [
    { id: 'first', type: 'HTTP_REQUEST', config: {} },
    {
      id: 'fork',
      type: 'CONDITIONAL',
      config: {
        condition: { variable: '{{trigger.x}}', operator: ConditionOperator.EXISTS },
        if_true: [
          { id: 'inner_a', type: 'HTTP_REQUEST', config: {} },
          { id: 'inner_b', type: 'HTTP_REQUEST', config: {} },
        ],
      },
    },
    { id: 'last', type: 'HTTP_REQUEST', config: {} },
  ],
} as unknown as WorkflowConfig;

describe('where a step goes to sit above another', () => {
  it('follows whatever the step follows, in the same list', () => {
    const { result } = builder(nested);
    expect(result.current.placeAbove('last')).toEqual({ afterStepId: 'fork' });
    expect(result.current.placeAbove('fork')).toEqual({ afterStepId: 'first' });
  });

  it('follows nothing when the step is first — which prepends to that list', () => {
    const { result } = builder(nested);
    expect(result.current.placeAbove('first')).toEqual({});
  });

  it('stays inside the branch the step lives in', () => {
    const { result } = builder(nested);
    expect(result.current.placeAbove('inner_b')).toEqual({
      afterStepId: 'inner_a',
      inBranch: { stepId: 'fork', branchKey: 'if_true' },
    });
  });

  it('prepends into the branch when the step is first inside it', () => {
    const { result } = builder(nested);
    expect(result.current.placeAbove('inner_a')).toEqual({
      inBranch: { stepId: 'fork', branchKey: 'if_true' },
    });
  });

  it('says nothing when there is no such step', () => {
    const { result } = builder(nested);
    expect(result.current.placeAbove('nope')).toBeNull();
  });

  it('actually lands the step there', () => {
    const { result } = builder(nested);
    act(() => {
      const place = result.current.placeAbove('last')!;
      result.current.addStep('HTTP_REQUEST', place.afterStepId, place.inBranch);
    });
    expect(result.current.config.steps.map((s) => s.id).slice(0, 2)).toEqual(['first', 'fork']);
    expect(result.current.config.steps.at(-1)?.id).toBe('last');
    expect(result.current.config.steps).toHaveLength(4);
  });

  it('lands it inside the branch, above the step it names', () => {
    const { result } = builder(nested);
    act(() => {
      const place = result.current.placeAbove('inner_a')!;
      result.current.addStep('HTTP_REQUEST', place.afterStepId, place.inBranch);
    });
    const fork = result.current.config.steps.find((s) => s.id === 'fork')!;
    const branch = (fork.config as { if_true: Array<{ id: string }> }).if_true;
    expect(branch.map((s) => s.id).slice(1)).toEqual(['inner_a', 'inner_b']);
    expect(branch).toHaveLength(3);
  });
});
