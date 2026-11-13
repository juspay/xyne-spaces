import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import { LiveEventsProvider } from './LiveEventsProvider.js';
import { useLiveWorkflow } from './use-live-workflow.js';
import { wfKeys } from '../hooks/queries.js';

type Handlers = Parameters<WorkflowClient['events']['subscribe']>[1];

function fakeClient() {
  const connections: Array<{ handlers: Handlers }> = [];
  const client = {
    origin: 'me',
    events: {
      subscribe(_topics: unknown, handlers: Handlers) {
        connections.push({ handlers });
        return () => {};
      },
    },
  } as unknown as WorkflowClient;
  return { client, connections };
}

function Subject({ id }: { id: string }) {
  useLiveWorkflow(id);
  return null;
}

describe('useLiveWorkflow', () => {
  it('invalidates that workflow\'s cache when it changes elsewhere', async () => {
    const { client, connections } = fakeClient();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <LiveEventsProvider client={client}>
          <Subject id="wf_1" />
        </LiveEventsProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    act(() => {
      connections[0]!.handlers.onEvent({
        event: 'workflow_changed',
        data: { workflowId: 'wf_1', change: 'updated', at: 't' },
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: wfKeys.workflow('wf_1') });
  });

  it('invalidates on a reconnect too, because the gap cannot be replayed', async () => {
    const { client, connections } = fakeClient();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <LiveEventsProvider client={client}>
          <Subject id="wf_1" />
        </LiveEventsProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    act(() => {
      connections[0]!.handlers.onOpen?.({
        subscribed: ['wf_1'],
        rejected: [],
        reconnected: true,
      });
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: wfKeys.workflow('wf_1') });
  });
});
