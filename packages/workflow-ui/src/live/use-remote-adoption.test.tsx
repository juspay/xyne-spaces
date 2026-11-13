import { describe, it, expect } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { WorkflowClient } from '@xyne/workflow-sdk/client';
import { LiveEventsProvider } from './LiveEventsProvider.js';
import { useRemoteAdoption } from './use-remote-adoption.js';
import { wfKeys } from '../hooks/queries.js';

type Handlers = Parameters<WorkflowClient['events']['subscribe']>[1];

function fakeClient() {
  const connections: Array<{ handlers: Handlers }> = [];
  const client = {
    origin: 'me',
    events: {
      subscribe(_t: unknown, handlers: Handlers) {
        connections.push({ handlers });
        return () => {};
      },
    },
  } as unknown as WorkflowClient;
  return { client, connections };
}

/** A fetch the test resolves by hand, so the refetch window can be inspected. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Observed {
  epoch: number;
  stale: boolean;
  adopt: () => void;
}

function harness(isDirty: () => boolean) {
  const { client, connections } = fakeClient();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const seen: Observed[] = [];
  const gate = deferred<string>();
  let fetches = 0;

  function Subject() {
    // An ACTIVE observer of the key, mirroring `useWorkflowDetail` in the real
    // screen. Without one, `invalidateQueries` marks the entry stale and resolves
    // at once without fetching anything — so the hook would bump immediately and
    // the test would pass while the product stayed broken.
    useQuery({
      queryKey: wfKeys.workflow('wf_1'),
      queryFn: async () => {
        fetches += 1;
        return gate.promise;
      },
      // Seeded and held fresh, so mounting reads nothing and the only fetch is
      // the one the notification provokes. (`initialData` alone is stale on
      // arrival and would refetch immediately.) `invalidateQueries` overrides
      // `staleTime` by design, so it still forces the read we are measuring.
      initialData: 'original',
      staleTime: Infinity,
    });

    const adoption = useRemoteAdoption('wf_1', isDirty);
    seen.push({ epoch: adoption.epoch, stale: adoption.stale, adopt: adoption.adopt });
    return null;
  }

  render(
    <QueryClientProvider client={queryClient}>
      <LiveEventsProvider client={client}>
        <Subject />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );

  const fire = () => {
    act(() => {
      connections[0]!.handlers.onEvent({
        event: 'workflow_changed',
        data: { workflowId: 'wf_1', change: 'updated', at: 't' },
      });
    });
  };

  return {
    connections,
    queryClient,
    fire,
    gate,
    fetchCount: () => fetches,
    latest: () => seen[seen.length - 1]!,
  };
}

describe('useRemoteAdoption', () => {
  it('does not bump the epoch until the refetch has actually landed', async () => {
    // The regression this exists for: bumping on the notification remounts the
    // editor against the copy we already had, and editors ignore their initial
    // config after mount — so the fresh copy that arrives next has nowhere to go
    // and the screen never changes.
    const h = harness(() => false);
    await waitFor(() => expect(h.connections).toHaveLength(1));
    const before = h.latest().epoch;

    h.fire();
    await waitFor(() => expect(h.fetchCount()).toBe(1));

    // Refetch in flight — remounting now would adopt stale data, permanently.
    expect(h.latest().epoch).toBe(before);

    await act(async () => {
      h.gate.resolve('updated');
      await Promise.resolve();
    });

    await waitFor(() => expect(h.latest().epoch).toBe(before + 1));
  });

  it('reports staleness instead of remounting while there are unsaved edits', async () => {
    const h = harness(() => true);
    await waitFor(() => expect(h.connections).toHaveLength(1));
    const before = h.latest().epoch;

    h.fire();
    await act(async () => {
      h.gate.resolve('updated');
      await Promise.resolve();
    });

    await waitFor(() => expect(h.latest().stale).toBe(true));
    expect(h.latest().epoch).toBe(before);
  });

  it('adopting clears the warning and remounts against data already read', async () => {
    const h = harness(() => true);
    await waitFor(() => expect(h.connections).toHaveLength(1));
    const before = h.latest().epoch;

    h.fire();
    await act(async () => {
      h.gate.resolve('updated');
      await Promise.resolve();
    });
    await waitFor(() => expect(h.latest().stale).toBe(true));

    act(() => {
      h.latest().adopt();
    });

    await waitFor(() => expect(h.latest().stale).toBe(false));
    expect(h.latest().epoch).toBe(before + 1);
  });

  it('stays put when nothing changed elsewhere', async () => {
    const h = harness(() => false);
    await waitFor(() => expect(h.connections).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));

    expect(h.latest().epoch).toBe(0);
    expect(h.latest().stale).toBe(false);
    expect(h.fetchCount()).toBe(0);
  });
});
