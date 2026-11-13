import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { WorkflowUIProvider } from '../components/provider/WorkflowUIProvider.js';
import { useApprovalsList } from './use-approvals-list.js';
import { wfKeys } from './queries.js';
import { useApprovalCount } from './use-approval-count.js';
import type { WorkflowClient, PendingApprovalBucket } from '@xyne/workflow-sdk/client';

/**
 * A bucket the hook forgets to send looks exactly like a bucket with nothing
 * in it — an empty section, no error, nothing in the console. These assert the
 * request that leaves, not the rows that come back.
 */
function makeClient() {
  const listPendingApprovals = vi.fn().mockResolvedValue({ items: [], nextCursor: undefined });
  const countPendingApprovals = vi.fn().mockResolvedValue(7);
  const client = {
    baseUrl: 'http://localhost',
    executions: {
      listPendingApprovals,
      countPendingApprovals,
      pendingApprovalFacets: vi.fn().mockResolvedValue({ workflows: [], stages: [], tags: [] }),
    },
  } as unknown as WorkflowClient;
  return { client, listPendingApprovals, countPendingApprovals };
}

const wrapper = (client: WorkflowClient) =>
  ({ children }: { children: React.ReactNode }) =>
    React.createElement(WorkflowUIProvider, { client, children });

describe('useApprovalsList', () => {
  it('sends the bucket and the day boundary to the server', async () => {
    const { client, listPendingApprovals } = makeClient();
    const dayEnd = new Date('2026-09-29T00:00:00').getTime();

    renderHook(() => useApprovalsList({ bucket: 'dueToday', dayEnd, sort: 'due' }), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(listPendingApprovals).toHaveBeenCalled());
    expect(listPendingApprovals.mock.calls[0]?.[0]).toMatchObject({
      bucket: 'dueToday',
      dayEnd,
      sort: 'due',
    });
  });

  it('omits them entirely when asking for the whole queue', async () => {
    const { client, listPendingApprovals } = makeClient();

    renderHook(() => useApprovalsList({ sort: 'oldest' }), { wrapper: wrapper(client) });

    await waitFor(() => expect(listPendingApprovals).toHaveBeenCalled());
    const sent = listPendingApprovals.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).not.toHaveProperty('bucket');
    expect(sent).not.toHaveProperty('dayEnd');
  });

  it('asks separate questions for separate buckets', async () => {
    const { client, listPendingApprovals } = makeClient();
    const dayEnd = 1_759_171_200_000;

    renderHook(
      () => {
        useApprovalsList({ bucket: 'overdue' });
        useApprovalsList({ bucket: 'dueToday', dayEnd });
      },
      { wrapper: wrapper(client) },
    );

    // Two different cache keys, so two requests — not one answer reused.
    await waitFor(() => expect(listPendingApprovals).toHaveBeenCalledTimes(2));
    const buckets = listPendingApprovals.mock.calls.map(
      (c) => (c[0] as { bucket?: string }).bucket,
    );
    expect(new Set(buckets)).toEqual(new Set(['overdue', 'dueToday']));
  });
});

describe('useApprovalCount', () => {
  it('counts one bucket when asked', async () => {
    const { client, countPendingApprovals } = makeClient();
    const dayEnd = 1_759_171_200_000;

    const { result } = renderHook(() => useApprovalCount({ bucket: 'overdue', dayEnd }), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current).toBe(7));
    expect(countPendingApprovals.mock.calls[0]?.[0]).toMatchObject({
      bucket: 'overdue',
      dayEnd,
    });
  });

  it('counts the whole queue when not', async () => {
    const { client, countPendingApprovals } = makeClient();

    const { result } = renderHook(() => useApprovalCount(), { wrapper: wrapper(client) });

    await waitFor(() => expect(result.current).toBe(7));
    expect(countPendingApprovals.mock.calls[0]?.[0]).toEqual({});
  });
});

describe('bucket switching', () => {
  it('keeps the bucket second-to-last in the cache key', () => {
    // The placeholder callback finds the previous bucket by position. If the
    // key is ever reshuffled this fails here, rather than silently reviving the
    // bug where Overdue's rows sat under the "Due today" pill.
    const key = wfKeys.approvalList({ bucket: 'overdue', dayEnd: 123 });
    expect(key.at(-2)).toBe('overdue');
    expect(key.at(-1)).toBe(123);
  });

  it('does not show one bucket\'s rows under another', async () => {
    const overdueRow = {
      id: 'a1', workflowId: 'wf', workflowName: 'late-one',
      pausedStepName: 'gate', pausedNodePath: 'gate', createdAt: new Date(),
    };
    const listPendingApprovals = vi
      .fn()
      .mockImplementation((params: { bucket?: string }) =>
        Promise.resolve({
          items: params.bucket === 'overdue' ? [overdueRow] : [],
          nextCursor: undefined,
        }),
      );
    const client = {
      baseUrl: 'http://localhost',
      executions: {
        listPendingApprovals,
        countPendingApprovals: vi.fn().mockResolvedValue(1),
        pendingApprovalFacets: vi.fn().mockResolvedValue({ workflows: [], stages: [], tags: [] }),
      },
    } as unknown as WorkflowClient;

    const { result, rerender } = renderHook(
      ({ bucket }: { bucket: PendingApprovalBucket }) => useApprovalsList({ bucket }),
      { wrapper: wrapper(client), initialProps: { bucket: 'overdue' as PendingApprovalBucket } },
    );

    await waitFor(() => expect(result.current.approvals).toHaveLength(1));

    // Switch pills. The previous bucket's row must not survive the switch, not
    // even for the length of the fetch.
    rerender({ bucket: 'dueToday' });
    expect(result.current.approvals).toEqual([]);
  });
});
