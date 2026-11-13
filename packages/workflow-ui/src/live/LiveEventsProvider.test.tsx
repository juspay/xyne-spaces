import { describe, it, expect } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import { LiveEventsProvider } from './LiveEventsProvider.js';
import { useWorkflowChanges } from './use-live-workflow.js';
import type { LiveChange } from './live-context.js';

type Handlers = Parameters<WorkflowClient['events']['subscribe']>[1];

interface Connection {
  workflows: string[];
  handlers: Handlers;
  stopped: boolean;
}

/** A client whose event stream is driven by the test rather than a network. */
function fakeClient(origin = 'me') {
  const connections: Connection[] = [];
  const client = {
    origin,
    events: {
      subscribe(topics: { workflows?: readonly string[] }, handlers: Handlers) {
        const connection: Connection = {
          workflows: [...(topics.workflows ?? [])],
          handlers,
          stopped: false,
        };
        connections.push(connection);
        return () => {
          connection.stopped = true;
        };
      },
    },
  } as unknown as WorkflowClient;

  const live = () => connections.filter((c) => !c.stopped);
  return { client, connections, live };
}

function Watcher({ id, sink }: { id: string; sink: LiveChange[] }) {
  useWorkflowChanges(id, (change) => sink.push(change));
  return null;
}

const changed = (workflowId: string, origin?: string) => ({
  event: 'workflow_changed' as const,
  data: {
    workflowId,
    change: 'updated' as const,
    at: '2026-01-01T00:00:00.000Z',
    ...(origin === undefined ? {} : { origin }),
  },
});

describe('LiveEventsProvider', () => {
  it('pools every watcher into a single connection', async () => {
    const { client, connections } = fakeClient();
    const sink: LiveChange[] = [];

    render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
        <Watcher id="wf_2" sink={sink} />
        <Watcher id="wf_3" sink={sink} />
      </LiveEventsProvider>,
    );

    // Three components, one connection — the whole point of the pool.
    await waitFor(() => expect(connections).toHaveLength(1));
    expect(connections[0]?.workflows).toEqual(['wf_1', 'wf_2', 'wf_3']);
  });

  it('opens no connection when nothing is watched', async () => {
    const { client, connections } = fakeClient();
    render(<LiveEventsProvider client={client}>{null}</LiveEventsProvider>);
    await new Promise((r) => setTimeout(r, 250));
    expect(connections).toHaveLength(0);
  });

  it('routes a change only to the watcher that asked for it', async () => {
    const { client, connections } = fakeClient();
    const first: LiveChange[] = [];
    const second: LiveChange[] = [];

    render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={first} />
        <Watcher id="wf_2" sink={second} />
      </LiveEventsProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    act(() => {
      connections[0]!.handlers.onEvent(changed('wf_1'));
    });

    expect(first).toEqual([{ workflowId: 'wf_1', reason: 'changed', change: 'updated' }]);
    expect(second).toEqual([]);
  });

  it('drops the echo of a write this client made', async () => {
    const { client, connections } = fakeClient('me');
    const sink: LiveChange[] = [];

    render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
      </LiveEventsProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    act(() => {
      connections[0]!.handlers.onEvent(changed('wf_1', 'me'));
    });

    expect(sink).toEqual([]);
  });

  it('delivers a change that another writer made', async () => {
    const { client, connections } = fakeClient('me');
    const sink: LiveChange[] = [];

    render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
      </LiveEventsProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    act(() => {
      connections[0]!.handlers.onEvent(changed('wf_1', 'someone-else'));
    });

    expect(sink).toHaveLength(1);
  });

  it('tells every watcher to re-read after a reconnect', async () => {
    // The stream cannot replay, so a reconnect means "you may have missed
    // something" for everything watched, not just for one topic.
    const { client, connections } = fakeClient();
    const first: LiveChange[] = [];
    const second: LiveChange[] = [];

    render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={first} />
        <Watcher id="wf_2" sink={second} />
      </LiveEventsProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    act(() => {
      connections[0]!.handlers.onOpen?.({
        subscribed: ['wf_1', 'wf_2'],
        rejected: [],
        reconnected: true,
      });
    });

    expect(first).toEqual([{ workflowId: 'wf_1', reason: 'resync' }]);
    expect(second).toEqual([{ workflowId: 'wf_2', reason: 'resync' }]);
  });

  it('does not ask for a re-read on the first open', async () => {
    const { client, connections } = fakeClient();
    const sink: LiveChange[] = [];

    render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
      </LiveEventsProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    act(() => {
      connections[0]!.handlers.onOpen?.({
        subscribed: ['wf_1'],
        rejected: [],
        reconnected: false,
      });
    });

    expect(sink).toEqual([]);
  });

  it('rebuilds the connection when the watched set changes, and drops the old one', async () => {
    const { client, connections, live } = fakeClient();
    const sink: LiveChange[] = [];

    const { rerender } = render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
      </LiveEventsProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    rerender(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
        <Watcher id="wf_2" sink={sink} />
      </LiveEventsProvider>,
    );

    await waitFor(() => expect(connections).toHaveLength(2));
    expect(connections[0]?.stopped).toBe(true);
    expect(live()).toHaveLength(1);
    expect(connections[1]?.workflows).toEqual(['wf_1', 'wf_2']);
  });

  it('coalesces watchers that mount together into one connection', async () => {
    // Several components registering in the same tick must not each cost a
    // connection — the reconcile waits for the set to settle.
    const { client, connections } = fakeClient();
    const sink: LiveChange[] = [];

    render(
      <LiveEventsProvider client={client}>
        {['wf_1', 'wf_2', 'wf_3', 'wf_4'].map((id) => (
          <Watcher key={id} id={id} sink={sink} />
        ))}
      </LiveEventsProvider>,
    );

    await waitFor(() => expect(connections.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 250));
    expect(connections).toHaveLength(1);
  });

  it('stops watching when the last watcher of a topic unmounts', async () => {
    const { client, connections } = fakeClient();
    const sink: LiveChange[] = [];

    const { rerender } = render(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
        <Watcher id="wf_2" sink={sink} />
      </LiveEventsProvider>,
    );
    await waitFor(() => expect(connections).toHaveLength(1));

    rerender(
      <LiveEventsProvider client={client}>
        <Watcher id="wf_1" sink={sink} />
      </LiveEventsProvider>,
    );

    await waitFor(() => expect(connections).toHaveLength(2));
    expect(connections[1]?.workflows).toEqual(['wf_1']);
  });

  it('degrades to a no-op when no live layer is mounted', () => {
    const sink: LiveChange[] = [];
    // No provider — a host may leave the live layer out entirely.
    expect(() => render(<Watcher id="wf_1" sink={sink} />)).not.toThrow();
  });
});
